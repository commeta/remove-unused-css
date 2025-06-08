/*!
 * Remove unused CSS 
 * https://github.com/commeta/remove-unused-css
 * Copyright 2025 Commeta
 * Released under the GPL v3 or MIT license
 */
(function () {
    'use strict';
    const CONFIG = { 
		CHECK_INTERVAL: 1000, 
		SERVER_ENDPOINT: '/remove-unused-css/remove-unused-css.php', 
		BUTTON_ID: 'unused-css-button', 
		MENU_ID: 'unused-css-menu' 
	};
    
    let state = { 
		unusedSelectors: new Map(), 
		styleSheetsInfo: new Map(), 
		isProcessing: false, 
		totalUnusedCount: 0, 
		currentPageSelectors: new Set() 
	};
    
    class CSSUtils {
        static async loadStyleSheetContent(href) {
            try {
                const response = await fetch(href);
                if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                return await response.text();
            } catch (error) {
                console.warn(`Не удалось загрузить стили: ${href}`, error);
                return '';
            }
        }
        static parseCSSText(cssText) {
            try {
                const styleElement = document.createElement('style');
                styleElement.textContent = cssText;
                document.head.appendChild(styleElement);
                const rules = styleElement.sheet?.cssRules || null;
                document.head.removeChild(styleElement);
                return rules;
            } catch (error) {
                console.warn('Ошибка при парсинге CSS:', error);
                return null;
            }
        }
        static isLocalUrl(url) {
            if (!url) return true;
            try {
                const urlObj = new URL(url, window.location.origin);
                return urlObj.origin === window.location.origin;
            } catch {
                return false;
            }
        }
        static normalizeSelector(selector) {
            return selector?.trim() || '';
        }
        static getRelativePathFromHref(href) {
            if (!href) return 'inline';
            try {
                const url = new URL(href, window.location.origin);
                return url.pathname.substring(1);
            } catch {
                return href;
            }
        }
        static getCurrentPageCSSFiles() {
            const cssFiles = new Set();
            document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                if (link.href) {
                    const relativePath = this.getRelativePathFromHref(link.href);
                    cssFiles.add(relativePath);
                }
            });
            if (document.querySelectorAll('style').length > 0) cssFiles.add('inline');
            return cssFiles;
        }
        static isSafeSelectorToCheck(selector) {
            if (!selector) return false;
            const trimmed = selector.trim();
            const NEVER_REMOVE_PATTERNS = [
                /:[a-z-]+/i,
                /::[a-z-]+/i,
                /@/,
                /--/,
                /-webkit-|-moz-|-ms-|-o-/,
                /keyframes|animation/i,
                /\[.*\]/,
                />/,
                /\+/,
                /~/,
                /\(/,
                /calc\(/i,
                /var\(/i,
                /url\(/i,
                /rgb\(/i,
                /hsl\(/i,
                /linear-gradient/i,
                /radial-gradient/i,
                /transform/i,
                /transition/i,
                /filter/i,
                /backdrop-filter/i,
                /mask/i,
                /clip-path/i,
                /nth-child/i,
                /nth-of-type/i,
                /not\(/i,
                /is\(/i,
                /where\(/i,
                /has\(/i
            ];
            
            if (NEVER_REMOVE_PATTERNS.some(pattern => pattern.test(trimmed))) return false;
            
            const CRITICAL_SELECTORS = [
				'html', 
				'body', 
				'*', 
				':root', 
				'head', 
				'title', 
				'meta', 
				'link', 
				'script', 
				'style', 
				'base'
			];
            
            if (CRITICAL_SELECTORS.includes(trimmed.toLowerCase())) return false;
            
            const SAFE_PATTERNS = [
                /^[a-zA-Z][a-zA-Z0-9-_]*$/,
                /^\.[a-zA-Z][a-zA-Z0-9-_]*$/,
                /^#[a-zA-Z][a-zA-Z0-9-_]*$/,
                /^[a-zA-Z][a-zA-Z0-9-_]*\.[a-zA-Z][a-zA-Z0-9-_]*$/,
                /^[a-zA-Z][a-zA-Z0-9-_]*#[a-zA-Z][a-zA-Z0-9-_]*$/
            ];
            
            return SAFE_PATTERNS.some(pattern => pattern.test(trimmed));
        }
    }
    class SelectorManager {
        static addSelector(selectorText, href, media = null) {
            if (!selectorText) return;
            const selectors = selectorText.split(',').map(s => CSSUtils.normalizeSelector(s));
            const relativePath = CSSUtils.getRelativePathFromHref(href);
            if (!state.currentPageSelectors.has(relativePath)) return;
            selectors.forEach(selector => {
                if (selector && !state.unusedSelectors.has(selector)) {
                    const isSafeToCheck = CSSUtils.isSafeSelectorToCheck(selector);
                    state.unusedSelectors.set(selector, {
                        href: relativePath,
                        media,
                        used: !isSafeToCheck,
                        safe: isSafeToCheck
                    });
                }
            });
            if (!state.styleSheetsInfo.has(relativePath)) {
                state.styleSheetsInfo.set(relativePath, []);
            }
            state.styleSheetsInfo.get(relativePath).push({ selector: selectorText, media });
        }
        static checkSelectorsUsage() {
            let unusedCount = 0;
            for (const [selector, info] of state.unusedSelectors.entries()) {
                if (!info.used && info.safe) {
                    try {
                        const exists = document.querySelector(selector);
                        if (exists) {
                            info.used = true;
                            state.unusedSelectors.delete(selector);
                        } else {
                            unusedCount++;
                        }
                    } catch (error) {
                        info.used = true;
                        state.unusedSelectors.delete(selector);
                    }
                }
            }
            state.totalUnusedCount = unusedCount;
            UIManager.updateButton(unusedCount);
        }
        static groupSelectorsByFile() {
            const result = {};
            for (const [selector, info] of state.unusedSelectors.entries()) {
                if (!info.safe || info.used) continue;
                const href = info.href;
                if (!result[href]) result[href] = [];
                result[href].push({ selector, media: info.media });
            }
            return result;
        }
    }
    class RuleProcessor {
        static async processStyleSheet(sheet) {
            let rules;
            try {
                rules = sheet.cssRules;
            } catch (error) {
                if (error.name === 'SecurityError') {
                    rules = await this.handleCrossOriginStyleSheet(sheet);
                } else {
                    console.warn(`Не удалось получить правила стилей:`, error);
                    return;
                }
            }
            if (!rules) return;
            for (const rule of rules) {
                await this.processRule(rule, sheet.href || 'inline');
            }
        }
        static async handleCrossOriginStyleSheet(sheet) {
            if (!sheet.href || !CSSUtils.isLocalUrl(sheet.href)) {
                console.warn(`Стилевой файл недоступен: ${sheet.href}`);
                return null;
            }
            const cssText = await CSSUtils.loadStyleSheetContent(sheet.href);
            return cssText ? CSSUtils.parseCSSText(cssText) : null;
        }
        static async processRule(rule, href) {
            switch (rule.type) {
                case CSSRule.STYLE_RULE:
                    SelectorManager.addSelector(rule.selectorText, href);
                    break;
                case CSSRule.MEDIA_RULE:
                    this.processMediaRule(rule, href);
                    break;
                case CSSRule.IMPORT_RULE:
                    if (rule.styleSheet) {
                        await this.processStyleSheet(rule.styleSheet);
                    }
                    break;
                case CSSRule.SUPPORTS_RULE:
                    for (const subRule of rule.cssRules) {
                        await this.processRule(subRule, href);
                    }
                    break;
                case CSSRule.KEYFRAMES_RULE:
                case CSSRule.FONT_FACE_RULE:
                case CSSRule.PAGE_RULE:
                case CSSRule.NAMESPACE_RULE:
                    break;
            }
        }
        static processMediaRule(mediaRule, href) {
            const media = mediaRule.media.mediaText;
            for (const rule of mediaRule.cssRules) {
                if (rule.type === CSSRule.STYLE_RULE) {
                    SelectorManager.addSelector(rule.selectorText, href, media);
                } else if (rule.type === CSSRule.MEDIA_RULE) {
                    this.processMediaRule(rule, href);
                }
            }
        }
    }
    class UIManager {
        static createFloatingButton() {
            if (document.getElementById(CONFIG.BUTTON_ID)) return;
            const container = document.createElement('div');
            container.style.cssText = `position: fixed; bottom: 20px; right: 20px; z-index: 9999;`;
            const button = document.createElement('button');
            button.id = CONFIG.BUTTON_ID;
            button.innerHTML = '0';
            button.title = 'Количество неиспользуемых CSS селекторов (безопасных для удаления)';
            button.style.cssText = `width: 50px; height: 50px; background-color: #e74c3c; color: white; border: none; border-radius: 50%; font-size: 14px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 8px rgba(0,0,0,0.3); transition: all 0.3s ease; display: flex; align-items: center; justify-content: center;`;
            const menu = document.createElement('div');
            menu.id = CONFIG.MENU_ID;
            menu.style.cssText = `position: absolute; bottom: 60px; right: 0; background: white; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); min-width: 200px; opacity: 0; transform: translateY(10px); transition: all 0.3s ease; pointer-events: none; border: 1px solid #ddd;`;
            const menuItems = [
                { text: 'Сохранить данные', action: 'save', icon: '💾' },
                { text: 'Генерировать файлы', action: 'generate', icon: '⚙️' },
                { text: 'Показать отчет', action: 'report', icon: '📊' }
            ];
            menuItems.forEach((item, index) => {
                const menuItem = document.createElement('div');
                menuItem.style.cssText = `padding: 12px 16px; cursor: pointer; border-bottom: ${index < menuItems.length - 1 ? '1px solid #eee' : 'none'}; display: flex; align-items: center; gap: 8px; font-size: 14px; color: #333; transition: background-color 0.2s ease;`;
                menuItem.innerHTML = `${item.icon} ${item.text}`;
                menuItem.addEventListener('mouseenter', () => {
                    menuItem.style.backgroundColor = '#f8f9fa';
                });
                menuItem.addEventListener('mouseleave', () => {
                    menuItem.style.backgroundColor = 'transparent';
                });
                menuItem.addEventListener('click', () => {
                    this.handleMenuClick(item.action);
                    this.hideMenu();
                });
                menu.appendChild(menuItem);
            });
            button.addEventListener('mouseenter', () => {
                if (!state.isProcessing) {
                    button.style.transform = 'scale(1.1)';
                    button.style.backgroundColor = '#c0392b';
                }
            });
            button.addEventListener('mouseleave', () => {
                if (!state.isProcessing) {
                    button.style.transform = 'scale(1)';
                    button.style.backgroundColor = '#e74c3c';
                }
            });
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });
            container.appendChild(button);
            container.appendChild(menu);
            document.body.appendChild(container);
            document.addEventListener('click', () => {
                this.hideMenu();
            });
            menu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
        static toggleMenu() {
            const menu = document.getElementById(CONFIG.MENU_ID);
            if (!menu) return;
            const isVisible = menu.style.opacity === '1';
            if (isVisible) {
                this.hideMenu();
            } else {
                this.showMenu();
            }
        }
        static showMenu() {
            const menu = document.getElementById(CONFIG.MENU_ID);
            if (!menu) return;
            menu.style.opacity = '1';
            menu.style.transform = 'translateY(0)';
            menu.style.pointerEvents = 'auto';
        }
        static hideMenu() {
            const menu = document.getElementById(CONFIG.MENU_ID);
            if (!menu) return;
            menu.style.opacity = '0';
            menu.style.transform = 'translateY(10px)';
            menu.style.pointerEvents = 'none';
        }
        static async handleMenuClick(action) {
            if (state.isProcessing) return;
            const button = document.getElementById(CONFIG.BUTTON_ID);
            if (!button) return;
            try {
                state.isProcessing = true;
                button.innerHTML = '...';
                button.style.backgroundColor = '#f39c12';
                button.style.cursor = 'not-allowed';
                button.disabled = true;
                const data = SelectorManager.groupSelectorsByFile();
                if (Object.keys(data).length === 0) {
                    this.showNotification('Безопасные для удаления селекторы не найдены', 'info');
                    return;
                }
                if (action === 'save') {
                    await this.saveDataToServer(data);
                } else if (action === 'generate') {
                    await this.generateFiles(data);
                } else if (action === 'report') {
                    this.showDetailedReport(data);
                }
            } catch (error) {
                console.error('Ошибка при обработке:', error);
                this.showNotification('Произошла ошибка при обработке', 'error');
            } finally {
                state.isProcessing = false;
                if (button) {
                    button.innerHTML = state.totalUnusedCount.toString();
                    button.style.backgroundColor = '#e74c3c';
                    button.style.cursor = 'pointer';
                    button.disabled = false;
                }
            }
        }
        static showDetailedReport(data) {
            let totalSelectors = 0;
            let reportHtml = '<div style="font-family: monospace; font-size: 12px; line-height: 1.4;">';
            reportHtml += '<h3 style="margin: 0 0 10px 0; color: #fff;">🔍 Отчет о неиспользуемых селекторах</h3>';
            reportHtml += '<div style="margin-bottom: 10px; padding: 8px; background: #f8f9fa; border-radius: 4px; color: #000;">';
            reportHtml += '<strong>⚠️ Внимание:</strong> Показаны только БЕЗОПАСНЫЕ для удаления селекторы.<br>';
            reportHtml += 'Анимации, псевдо-селекторы и браузерные префиксы НЕ удаляются.';
            reportHtml += '</div>';
            for (const [file, selectors] of Object.entries(data)) {
                if (selectors.length === 0) continue;
                totalSelectors += selectors.length;
                reportHtml += `<div style="margin-bottom: 10px; border: 1px solid #ddd; border-radius: 4px; padding: 8px;">`;
                reportHtml += `<strong style="color: #fff; font-weight: bolder;">📄 ${file}</strong> (${selectors.length} селекторов)<br>`;
                const selectorList = selectors.slice(0, 10).map(s => s.selector).join(', ');
                reportHtml += `<small style="color: #fff;">${selectorList}`;
                if (selectors.length > 10) {
                    reportHtml += ` ... и еще ${selectors.length - 10}`;
                }
                reportHtml += '</small></div>';
            }
            reportHtml += `<div style="margin-top: 10px; padding: 8px; background: #e8f5e8; border-radius: 4px; border: 1px solid #4caf50; color: #000;">`;
            reportHtml += `<strong>📊 Итого: ${totalSelectors} безопасных селекторов в ${Object.keys(data).length} файлах</strong>`;
            reportHtml += '</div></div>';
            this.showLargeNotification(reportHtml, 'info', true);
        }
        static async saveDataToServer(data) {
            try {
                const response = await fetch(CONFIG.SERVER_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Action': 'save'
                    },
                    body: JSON.stringify(data)
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const result = await response.json();
                if (result.success) {
                    const selectorsCount = Object.values(data).reduce((sum, selectors) => sum + selectors.length, 0);
                    this.showNotification(`Сохранено селекторов: ${selectorsCount} из ${Object.keys(data).length} файлов`, 'success');
                } else {
                    throw new Error(result.error || 'Неизвестная ошибка сервера');
                }
            } catch (error) {
                console.error('Ошибка сохранения данных:', error);
                throw error;
            }
        }
        static async generateFiles(data) {
            try {
                const response = await fetch(CONFIG.SERVER_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Action': 'generate'
                    },
                    body: JSON.stringify(data)
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const result = await response.json();
                if (result.success) {
                    this.showGenerationStatistics(result);
                } else {
                    throw new Error(result.error || 'Неизвестная ошибка сервера');
                }
            } catch (error) {
                console.error('Ошибка генерации файлов:', error);
                throw error;
            }
        }
        static showGenerationStatistics(result) {
            const stats = result.statistics || {};
            const message = `Генерация завершена!\n\n📁 Обработано файлов: ${stats.processed_files || 0}\n📄 Создано файлов: ${stats.generated_files || 0}\n💾 Объединенный файл: ${stats.combined_file ? 'Да' : 'Нет'}\n📊 Очищено байт: ${this.formatBytes(stats.bytes_saved || 0)}\n🎯 Удалено селекторов: ${stats.selectors_removed || 0}\n⚡ Размер до: ${this.formatBytes(stats.original_size || 0)}\n⚡ Размер после: ${this.formatBytes(stats.final_size || 0)}`;
            this.showLargeNotification(message, 'success');
        }
        static formatBytes(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }
        static updateButton(count) {
            const button = document.getElementById(CONFIG.BUTTON_ID);
            if (button) {
                button.innerHTML = count.toString();
                if (count > 0) {
                    button.style.backgroundColor = '#e74c3c';
                } else {
                    button.style.backgroundColor = '#27ae60';
                }
            }
        }
        static showNotification(message, type = 'info') {
            this.createNotification(message, type, false);
        }
        static showLargeNotification(message, type = 'info', isHtml = false) {
            this.createNotification(message, type, true, isHtml);
        }
        static createNotification(message, type = 'info', isLarge = false, isHtml = false) {
            const existingNotification = document.getElementById('unused-css-notification');
            if (existingNotification) {
                existingNotification.remove();
            }
            const notification = document.createElement('div');
            notification.id = 'unused-css-notification';
            const colors = {
                success: '#27ae60',
                error: '#e74c3c',
                info: '#3498db'
            };
            const baseStyles = {
                position: 'fixed',
                top: '20px',
                right: '20px',
                padding: isLarge ? '20px' : '12px 20px',
                backgroundColor: colors[type] || colors.info,
                color: 'white',
                borderRadius: '8px',
                fontSize: '14px',
                zIndex: '10000',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                maxWidth: isLarge ? '500px' : '300px',
                maxHeight: isLarge ? '400px' : 'auto',
                overflowY: isLarge ? 'auto' : 'visible',
                wordWrap: 'break-word',
                whiteSpace: isLarge ? 'pre-line' : 'normal',
                fontFamily: isLarge ? 'monospace' : 'inherit'
            };
            Object.assign(notification.style, baseStyles);
            if (isHtml) {
                notification.innerHTML = message;
            } else {
                notification.textContent = message;
            }
            if (isLarge) {
                const closeButton = document.createElement('button');
                closeButton.innerHTML = '✕';
                closeButton.style.cssText = `position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.2); border: none; color: white; width: 20px; height: 20px; border-radius: 50%; cursor: pointer; font-size: 12px; display: flex; align-items: center; justify-content: center;`;
                closeButton.addEventListener('click', () => {
                    notification.remove();
                });
                notification.appendChild(closeButton);
            }
            document.body.appendChild(notification);
            const timeout = isLarge ? 20000 : 5000;
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, timeout);
        }
    }
    class UnusedCSSDetector {
        static async init() {
            try {
                state.currentPageSelectors = CSSUtils.getCurrentPageCSSFiles();
                await this.loadStyleSheets();
                UIManager.createFloatingButton();
                this.startPeriodicCheck();
                console.log('Remove Unused CSS загружен (консервативный режим)');
                console.log('CSS файлы на странице:', Array.from(state.currentPageSelectors));
                console.log('Всего селекторов найдено:', state.unusedSelectors.size);
                const safeCount = Array.from(state.unusedSelectors.values()).filter(info => info.safe).length;
                console.log('Безопасных для проверки:', safeCount);
                window.unusedCSSState = state;
            } catch (error) {
                console.error('Ошибка инициализации Remove Unused CSS:', error);
            }
        }
        static async loadStyleSheets() {
            const sheets = Array.from(document.styleSheets);
            for (const sheet of sheets) {
                try {
                    const relativePath = CSSUtils.getRelativePathFromHref(sheet.href);
                    if (state.currentPageSelectors.has(relativePath)) {
                        await RuleProcessor.processStyleSheet(sheet);
                    }
                } catch (error) {
                    console.warn('Ошибка обработки стилевого листа:', sheet.href, error);
                }
            }
        }
        static startPeriodicCheck() {
            SelectorManager.checkSelectorsUsage();
            setInterval(() => {
                if (!state.isProcessing) {
                    SelectorManager.checkSelectorsUsage();
                }
            }, CONFIG.CHECK_INTERVAL);
        }
    }
    class DOMChangeHandler {
        static init() {
            const observer = new MutationObserver((mutations) => {
                let shouldCheck = false;
                mutations.forEach((mutation) => {
                    if (mutation.type === 'childList' &&
                        (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                        shouldCheck = true;
                    } else if (mutation.type === 'attributes' &&
                        (mutation.attributeName === 'class' || mutation.attributeName === 'id')) {
                        shouldCheck = true;
                    }
                });
                if (shouldCheck && !state.isProcessing) {
                    clearTimeout(this.checkTimeout);
                    this.checkTimeout = setTimeout(() => {
                        SelectorManager.checkSelectorsUsage();
                    }, 100);
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'id']
            });
        }
    }
    function startApp() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                UnusedCSSDetector.init();
                DOMChangeHandler.init();
            });
        } else {
            UnusedCSSDetector.init();
            DOMChangeHandler.init();
        }
    }
    startApp();
})();
