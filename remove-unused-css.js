/*!
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2025 Commeta
 * Released under the GPL v3 or MIT license
 */

(function() {
    'use strict';

    // Конфигурация
    const CONFIG = {
        CHECK_INTERVAL: 1000,
        SERVER_ENDPOINT: '/remove-unused-css/remove-unused-css.php',
        BUTTON_ID: 'unused-css-button',
        MENU_ID: 'unused-css-menu'
    };

    // Состояние приложения
    let state = {
        unusedSelectors: new Map(),
        styleSheetsInfo: new Map(),
        isProcessing: false,
        totalUnusedCount: 0,
        currentPageSelectors: new Set()
    };

    /**
     * Утилиты для работы с CSS
     */
    class CSSUtils {
        /**
         * Загружает содержимое CSS файла
         * @param {string} href - URL файла
         * @returns {Promise<string>} - Содержимое файла
         */
        static async loadStyleSheetContent(href) {
            try {
                const response = await fetch(href);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return await response.text();
            } catch (error) {
                console.warn(`Не удалось загрузить стили: ${href}`, error);
                return '';
            }
        }

        /**
         * Парсит CSS текст и возвращает правила
         * @param {string} cssText - CSS текст
         * @returns {CSSRuleList|null} - Список правил
         */
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

        /**
         * Проверяет, является ли URL локальным
         * @param {string} url - URL для проверки
         * @returns {boolean}
         */
        static isLocalUrl(url) {
            if (!url) return true; // inline стили
            try {
                const urlObj = new URL(url, window.location.origin);
                return urlObj.origin === window.location.origin;
            } catch {
                return false;
            }
        }

        /**
         * Нормализует селектор
         * @param {string} selector - CSS селектор
         * @returns {string}
         */
        static normalizeSelector(selector) {
            return selector?.trim() || '';
        }

        /**
         * Преобразует полный URL в относительный путь
         * @param {string} href - URL файла
         * @returns {string} - Относительный путь
         */
        static getRelativePathFromHref(href) {
            if (!href) return 'inline';
            
            try {
                const url = new URL(href, window.location.origin);
                return url.pathname.substring(1); // убираем ведущий слеш
            } catch {
                return href;
            }
        }

        /**
         * Получает список всех CSS файлов на текущей странице
         * @returns {Set<string>} - Множество путей к CSS файлам
         */
        static getCurrentPageCSSFiles() {
            const cssFiles = new Set();
            
            // Собираем все link элементы с CSS
            document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
                if (link.href) {
                    const relativePath = this.getRelativePathFromHref(link.href);
                    cssFiles.add(relativePath);
                }
            });

            // Добавляем inline стили
            if (document.querySelectorAll('style').length > 0) {
                cssFiles.add('inline');
            }

            return cssFiles;
        }
    }

    /**
     * Класс для работы с селекторами
     */
    class SelectorManager {
        /**
         * Добавляет селектор в список
         * @param {string} selectorText - Текст селектора
         * @param {string} href - URL файла
         * @param {string|null} media - Media query
         */
        static addSelector(selectorText, href, media = null) {
            if (!selectorText) return;

            const selectors = selectorText.split(',').map(s => CSSUtils.normalizeSelector(s));
            const relativePath = CSSUtils.getRelativePathFromHref(href);
            
            // Проверяем, что файл присутствует на текущей странице
            if (!state.currentPageSelectors.has(relativePath)) {
                return;
            }
            
            selectors.forEach(selector => {
                if (selector && !state.unusedSelectors.has(selector)) {
                    state.unusedSelectors.set(selector, {
                        href: relativePath,
                        media,
                        used: false
                    });
                }
            });

            // Сохраняем информацию о файле
            if (!state.styleSheetsInfo.has(relativePath)) {
                state.styleSheetsInfo.set(relativePath, []);
            }
            
            state.styleSheetsInfo.get(relativePath).push({
                selector: selectorText,
                media
            });
        }

        /**
         * Проверяет использование селекторов в DOM
         */
        static checkSelectorsUsage() {
            let unusedCount = 0;
            
            for (const [selector, info] of state.unusedSelectors.entries()) {
                if (!info.used) {
                    try {
                        if (document.querySelector(selector)) {
                            info.used = true;
                            state.unusedSelectors.delete(selector);
                        } else {
                            unusedCount++;
                        }
                    } catch (error) {
                        // Некорректный селектор, считаем неиспользуемым
                        unusedCount++;
                    }
                }
            }
            
            state.totalUnusedCount = unusedCount;
            UIManager.updateButton(unusedCount);
        }

        /**
         * Группирует селекторы по файлам для отправки на сервер
         * @returns {Object}
         */
        static groupSelectorsByFile() {
            const result = {};
            
            for (const [selector, info] of state.unusedSelectors.entries()) {
                const href = info.href;
                
                if (!result[href]) {
                    result[href] = [];
                }
                
                result[href].push({
                    selector,
                    media: info.media
                });
            }
            
            return result;
        }
    }

    /**
     * Класс для обработки CSS правил
     */
    class RuleProcessor {
        /**
         * Обрабатывает стилевой лист
         * @param {CSSStyleSheet} sheet - Стилевой лист
         */
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

        /**
         * Обрабатывает кросс-доменные стили
         * @param {CSSStyleSheet} sheet - Стилевой лист
         * @returns {CSSRuleList|null}
         */
        static async handleCrossOriginStyleSheet(sheet) {
            if (!sheet.href || !CSSUtils.isLocalUrl(sheet.href)) {
                console.warn(`Стилевой файл недоступен: ${sheet.href}`);
                return null;
            }
            
            const cssText = await CSSUtils.loadStyleSheetContent(sheet.href);
            return cssText ? CSSUtils.parseCSSText(cssText) : null;
        }

        /**
         * Обрабатывает отдельное CSS правило
         * @param {CSSRule} rule - CSS правило
         * @param {string} href - URL файла
         */
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
            }
        }

        /**
         * Обрабатывает @media правила
         * @param {CSSMediaRule} mediaRule - Media правило
         * @param {string} href - URL файла
         */
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

    /**
     * Класс для управления UI
     */
    class UIManager {
        /**
         * Создает плавающую кнопку с меню
         */
        static createFloatingButton() {
            if (document.getElementById(CONFIG.BUTTON_ID)) {
                return; // Кнопка уже существует
            }

            // Создаем контейнер
            const container = document.createElement('div');
            container.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                z-index: 9999;
            `;

            // Создаем кнопку
            const button = document.createElement('button');
            button.id = CONFIG.BUTTON_ID;
            button.innerHTML = '0';
            button.title = 'Количество неиспользуемых CSS селекторов';
            
            button.style.cssText = `
                width: 50px;
                height: 50px;
                background-color: #e74c3c;
                color: white;
                border: none;
                border-radius: 50%;
                font-size: 14px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            // Создаем меню
            const menu = document.createElement('div');
            menu.id = CONFIG.MENU_ID;
            menu.style.cssText = `
                position: absolute;
                bottom: 60px;
                right: 0;
                background: white;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                min-width: 200px;
                opacity: 0;
                transform: translateY(10px);
                transition: all 0.3s ease;
                pointer-events: none;
                border: 1px solid #ddd;
            `;

            // Пункты меню
            const menuItems = [
                { text: 'Сохранить данные', action: 'save', icon: '💾' },
                { text: 'Генерировать файлы', action: 'generate', icon: '⚙️' }
            ];

            menuItems.forEach((item, index) => {
                const menuItem = document.createElement('div');
                menuItem.style.cssText = `
                    padding: 12px 16px;
                    cursor: pointer;
                    border-bottom: ${index < menuItems.length - 1 ? '1px solid #eee' : 'none'};
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    color: #333;
                    transition: background-color 0.2s ease;
                `;

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

            // Добавляем hover эффекты для кнопки
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

            // Обработчик клика по кнопке (показать/скрыть меню)
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });

            container.appendChild(button);
            container.appendChild(menu);
            document.body.appendChild(container);

            // Скрываем меню при клике вне его
            document.addEventListener('click', () => {
                this.hideMenu();
            });

            menu.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }

        /**
         * Показывает/скрывает меню
         */
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

        /**
         * Показывает меню
         */
        static showMenu() {
            const menu = document.getElementById(CONFIG.MENU_ID);
            if (!menu) return;

            menu.style.opacity = '1';
            menu.style.transform = 'translateY(0)';
            menu.style.pointerEvents = 'auto';
        }

        /**
         * Скрывает меню
         */
        static hideMenu() {
            const menu = document.getElementById(CONFIG.MENU_ID);
            if (!menu) return;

            menu.style.opacity = '0';
            menu.style.transform = 'translateY(10px)';
            menu.style.pointerEvents = 'none';
        }

        /**
         * Обрабатывает клик по пункту меню
         * @param {string} action - Действие (save/generate)
         */
        static async handleMenuClick(action) {
            if (state.isProcessing) {
                return;
            }

            const button = document.getElementById(CONFIG.BUTTON_ID);
            if (!button) return;

            try {
                state.isProcessing = true;
                
                // Визуальная индикация загрузки
                button.innerHTML = '...';
                button.style.backgroundColor = '#f39c12';
                button.style.cursor = 'not-allowed';
                button.disabled = true;

                const data = SelectorManager.groupSelectorsByFile();
                
                if (Object.keys(data).length === 0) {
                    this.showNotification('Неиспользуемые селекторы не найдены', 'info');
                    return;
                }

                if (action === 'save') {
                    await this.saveDataToServer(data);
                } else if (action === 'generate') {
                    await this.generateFiles(data);
                }
                
            } catch (error) {
                console.error('Ошибка при обработке:', error);
                this.showNotification('Произошла ошибка при обработке', 'error');
            } finally {
                state.isProcessing = false;
                
                // Восстанавливаем состояние кнопки
                if (button) {
                    button.innerHTML = state.totalUnusedCount.toString();
                    button.style.backgroundColor = '#e74c3c';
                    button.style.cursor = 'pointer';
                    button.disabled = false;
                }
            }
        }

        /**
         * Сохраняет данные на сервере
         * @param {Object} data - Данные для сохранения
         */
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
                    this.showNotification(
                        `Сохранено селекторов: ${selectorsCount} из ${Object.keys(data).length} файлов`, 
                        'success'
                    );
                } else {
                    throw new Error(result.error || 'Неизвестная ошибка сервера');
                }
                
            } catch (error) {
                console.error('Ошибка сохранения данных:', error);
                throw error;
            }
        }

        /**
         * Генерирует файлы на сервере
         * @param {Object} data - Данные для генерации
         */
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

        /**
         * Показывает статистику генерации
         * @param {Object} result - Результат генерации
         */
        static showGenerationStatistics(result) {
            const stats = result.statistics || {};
            const message = `
Генерация завершена!

📁 Обработано файлов: ${stats.processed_files || 0}
📄 Создано файлов: ${stats.generated_files || 0}
💾 Объединенный файл: ${stats.combined_file ? 'Да' : 'Нет'}
📊 Очищено байт: ${this.formatBytes(stats.bytes_saved || 0)}
🎯 Удалено селекторов: ${stats.selectors_removed || 0}
⚡ Размер до: ${this.formatBytes(stats.original_size || 0)}
⚡ Размер после: ${this.formatBytes(stats.final_size || 0)}
            `.trim();

            this.showLargeNotification(message, 'success');
        }

        /**
         * Форматирует размер в байтах
         * @param {number} bytes - Размер в байтах
         * @returns {string} - Отформатированный размер
         */
        static formatBytes(bytes) {
            if (bytes === 0) return '0 Bytes';
            const k = 1024;
            const sizes = ['Bytes', 'KB', 'MB', 'GB'];
            const i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
        }

        /**
         * Обновляет текст кнопки
         * @param {number} count - Количество неиспользуемых селекторов
         */
        static updateButton(count) {
            const button = document.getElementById(CONFIG.BUTTON_ID);
            if (button) {
                button.innerHTML = count.toString();
            }
        }

        /**
         * Показывает уведомление
         * @param {string} message - Текст сообщения
         * @param {string} type - Тип уведомления (success, error, info)
         */
        static showNotification(message, type = 'info') {
            this.createNotification(message, type, false);
        }

        /**
         * Показывает большое уведомление со статистикой
         * @param {string} message - Текст сообщения
         * @param {string} type - Тип уведомления
         */
        static showLargeNotification(message, type = 'info') {
            this.createNotification(message, type, true);
        }

        /**
         * Создает уведомление
         * @param {string} message - Текст сообщения
         * @param {string} type - Тип уведомления
         * @param {boolean} isLarge - Большое уведомление
         */
        static createNotification(message, type = 'info', isLarge = false) {
            // Удаляем предыдущее уведомление, если есть
            const existingNotification = document.getElementById('unused-css-notification');
            if (existingNotification) {
                existingNotification.remove();
            }

            const notification = document.createElement('div');
            notification.id = 'unused-css-notification';
            
            // Цвета для разных типов
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
                maxWidth: isLarge ? '400px' : '300px',
                wordWrap: 'break-word',
                whiteSpace: isLarge ? 'pre-line' : 'normal',
                fontFamily: isLarge ? 'monospace' : 'inherit'
            };

            Object.assign(notification.style, baseStyles);
            notification.textContent = message;

            // Добавляем кнопку закрытия для больших уведомлений
            if (isLarge) {
                const closeButton = document.createElement('button');
                closeButton.innerHTML = '✕';
                closeButton.style.cssText = `
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: rgba(255,255,255,0.2);
                    border: none;
                    color: white;
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    cursor: pointer;
                    font-size: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                `;
                
                closeButton.addEventListener('click', () => {
                    notification.remove();
                });
                
                notification.appendChild(closeButton);
            }

            document.body.appendChild(notification);

            // Автоматически удаляем уведомление
            const timeout = isLarge ? 15000 : 5000; // 15 сек для больших, 5 сек для обычных
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.remove();
                }
            }, timeout);
        }
    }

    /**
     * Главный класс приложения
     */
    class UnusedCSSDetector {
        /**
         * Инициализация приложения
         */
        static async init() {
            try {
                // Получаем список CSS файлов текущей страницы
                state.currentPageSelectors = CSSUtils.getCurrentPageCSSFiles();
                
                await this.loadStyleSheets();
                UIManager.createFloatingButton();
                this.startPeriodicCheck();
                
                console.log('Remove Unused CSS загружен');
                console.log('CSS файлы на странице:', Array.from(state.currentPageSelectors));
                
                // Экспортируем состояние в глобальную область для отладки
                window.unusedCSSState = state;
                
            } catch (error) {
                console.error('Ошибка инициализации Remove Unused CSS:', error);
            }
        }

        /**
         * Загружает все стилевые листы
         */
        static async loadStyleSheets() {
            const sheets = Array.from(document.styleSheets);
            
            for (const sheet of sheets) {
                try {
                    // Проверяем, что лист относится к файлам текущей страницы
                    const relativePath = CSSUtils.getRelativePathFromHref(sheet.href);
                    if (state.currentPageSelectors.has(relativePath)) {
                        await RuleProcessor.processStyleSheet(sheet);
                    }
                } catch (error) {
                    console.warn('Ошибка обработки стилевого листа:', sheet.href, error);
                }
            }
            
            console.log(`Загружено селекторов: ${state.unusedSelectors.size}`);
        }

        /**
         * Запускает периодическую проверку селекторов
         */
        static startPeriodicCheck() {
            // Первоначальная проверка
            SelectorManager.checkSelectorsUsage();
            
            // Периодическая проверка
            setInterval(() => {
                if (!state.isProcessing) {
                    SelectorManager.checkSelectorsUsage();
                }
            }, CONFIG.CHECK_INTERVAL);
        }
    }

    /**
     * Обработчик изменений DOM
     */
    class DOMChangeHandler {
        static init() {
            // Наблюдатель за изменениями DOM
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
                    // Небольшая задержка для избежания частых проверок
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

    /**
     * Запуск приложения
     */
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

    // Запускаем приложение
    startApp();

})();
