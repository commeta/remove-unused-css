/*!
 * Remove unused CSS 
 * https://github.com/commeta/remove-unused-css
 * Copyright 2025 Commeta
 * Released under the GPL v3 or MIT license
 */

(function () {

    // Конфигурация приложения для удаления неиспользуемого CSS
    const CONFIG = {
        // Интервал (в миллисекундах) между проверками/сканированием страницы
        CHECK_INTERVAL: 1000,

        // Путь до серверного скрипта, обрабатывающего запросы по сохранению и генерации CSS
        SERVER_ENDPOINT: '/remove-unused-css/remove-unused-css.php',

        // HTML-ID кнопки, по клику на которую начинается процесс поиска неиспользуемых селекторов
        BUTTON_ID: 'unused-css-button',

        // HTML-ID контейнера, в котором отображается меню с результатами и дополнительными действиями
        MENU_ID: 'unused-css-menu',

        // HTML-ID блока настроек фильтрации (какие правила/селекторы сохранять)
        SETTINGS_ID: 'unused-css-settings',

        CRAWLER_DB_NAME: 'SiteCrawlerDB',
        CRAWLER_DB_VERSION: 1,
        CRAWLER_STORE_NAME: 'crawled_urls',
        CRAWLER_STATUS_KEY: 'crawler_status',
        MAX_CRAWL_DEPTH: 5,
        CRAWL_DELAY: 3000,
        MAX_URLS_PER_SESSION: 100

    };




    // Состояние приложения: хранит данные для анализа и настройки очистки CSS
    let state = {
        // Map для хранения неиспользованных селекторов: ключ — селектор, значение — детали использования
        unusedSelectors: new Map(),

        // Map для информации о стилевых таблицах (CSS-файлах): ключ — URL или путь, значение — объект с метаданными
        styleSheetsInfo: new Map(),

        // Флаг, указывающий, идёт ли сейчас процесс анализа/генерации
        isProcessing: false,

        // Общее количество неиспользованных селекторов на всех страницах
        totalUnusedCount: 0,

        // Set селекторов, найденных на текущей странице
        currentPageSelectors: new Set(),

        // Настройки фильтрации/сохранения разных видов правил и селекторов
        settings: {
            media: true,               // флаг сохранения @media
            media_print: true,         // флаг сохранения @media print
            keyframes: true,           // флаг сохранения анимаций @keyframes
            font_face: true,           // флаг сохранения @font-face
            import: true,              // флаг сохранения @import
            supports: true,            // флаг сохранения @supports
            page: true,                // флаг сохранения @page
            charset: true,             // флаг сохранения @charset
            counter_style: true,       // флаг сохранения @counter-style
            layer: true,               // флаг сохранения @layer
            pseudo_classes: true,      // флаг сохранения псевдоклассов (:hover, :nth-child и т.д.)
            pseudo_elements: true,     // флаг сохранения псевдоэлементов (::before, ::after и т.д.)
            attribute_selectors: true, // флаг сохранения селекторов по атрибутам ([data-*], [href] и т.п.)
            css_variables: true,       // флаг сохранения CSS-переменных (--var-name)
            vendor_prefixes: true,     // флаг сохранения свойств с префиксами (-webkit-, -moz- и др.)
            adjacent_selectors: true,  // флаг сохранения селекторов соседних элементов (E + F)
            child_selectors: true,     // флаг сохранения селекторов дочерних элементов (E > F)
            general_siblings: true,    // флаг сохранения селекторов общих соседних элементов (E ~ F)
            css_functions: true,       // флаг сохранения правил с функциями (calc(), url(), rgb() и др.)
            animations: true,          // флаг сохранения анимационных свойств (animation, transition)
            transforms: true,          // флаг сохранения трансформаций (transform)
            transitions: true,         // флаг сохранения переходов (transition)
            percentages: true,         // флаг сохранения значений в процентах (50%, 100%)
            escapes: true,             // флаг сохранения escape-последовательностей (\\3020 и т.п.)
            colors: true,              // флаг сохранения цветовых функций (rgb(), hsl())
            gradients: true,           // флаг сохранения градиентов (linear-gradient, radial-gradient)
            filters: true,             // флаг сохранения фильтров (filter, backdrop-filter)
            masks: true,               // флаг сохранения масок (mask, clip-path)
            nth_selectors: true,       // флаг сохранения :nth-child, :nth-of-type
            logical_selectors: true    // флаг сохранения логических селекторов (:not(), :is(), :has())
        }
    };



    // CSS Utilities
    class CSSUtils {
        static isSafeSelectorToCheck(selector) {
            if (!selector) return false;
            const trimmed = selector.trim();

            // Bypass selectors by settings
            if (state.settings.pseudo_classes && /:[a-z-]+(\([^)]*\))?/i.test(trimmed)) return false;
            if (state.settings.pseudo_elements && /::[a-z-]+/i.test(trimmed)) return false;
            if (state.settings.attribute_selectors && /\[[\w\-="\':\s]*\]/.test(trimmed)) return false;
            if (state.settings.css_variables && /--[\w\-]+/.test(trimmed)) return false;
            if (state.settings.vendor_prefixes && /-webkit-|-moz-|-ms-|-o-/.test(trimmed)) return false;
            if (state.settings.adjacent_selectors && /\+/.test(trimmed)) return false;
            if (state.settings.child_selectors && />/.test(trimmed)) return false;
            if (state.settings.general_siblings && /~/.test(trimmed)) return false;
            if (state.settings.css_functions && /\(/.test(trimmed)) return false;
            if (state.settings.animations && /animation|keyframes/i.test(trimmed)) return false;
            if (state.settings.transforms && /transform/i.test(trimmed)) return false;
            if (state.settings.transitions && /transition/i.test(trimmed)) return false;
            if (state.settings.percentages && /\d+%/.test(trimmed)) return false;
            if (state.settings.escapes && /\\\\/.test(trimmed)) return false;
            if (state.settings.colors && /rgb\(|rgba\(|hsl\(|hsla\(/i.test(trimmed)) return false;
            if (state.settings.gradients && /linear-gradient|radial-gradient/i.test(trimmed)) return false;
            if (state.settings.filters && /filter|backdrop-filter/i.test(trimmed)) return false;
            if (state.settings.masks && /mask|clip-path/i.test(trimmed)) return false;
            if (state.settings.nth_selectors && /nth-child|nth-of-type/i.test(trimmed)) return false;
            if (state.settings.logical_selectors && /not\(|is\(|where\(|has\(/i.test(trimmed)) return false;

            // Critical tags
            const critical = [
                'html', 'body', '*', ':root', 'head', 'title', 'meta', 'link', 'script', 'style', 'base'
            ];
            if (critical.includes(trimmed.toLowerCase())) return false;


            // Набор регулярных выражений для безопасных (простых) селекторов CSS
            const safePatterns = [
                // тег (например, div, span)
                /^[a-zA-Z][a-zA-Z0-9-_]*$/,

                // класс (например, .container, .btn-primary)
                /^\.[a-zA-Z][a-zA-Z0-9-_]*$/,

                // идентификатор (например, #header, #main-content)
                /^#[a-zA-Z][a-zA-Z0-9-_]*$/,

                // тег с классом (например, button.primary, li.active)
                /^[a-zA-Z][a-zA-Z0-9-_]*\.[a-zA-Z][a-zA-Z0-9-_]*$/,

                // тег с идентификатором (например, div#footer, section#intro)
                /^[a-zA-Z][a-zA-Z0-9-_]*#[a-zA-Z][a-zA-Z0-9-_]*$/
            ];


            return safePatterns.some(pattern => pattern.test(trimmed));
        }

        static async loadStyleSheetContent(href) {
            try {
                const response = await fetch(href, {
                    method: 'GET',
                    mode: 'cors',
                    cache: 'no-cache',
                    credentials: 'omit'
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                return await response.text();
            } catch (error) {
                console.warn(`Не удалось загрузить: ${href}`, error);
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
                console.warn('Ошибка парсинга CSS:', error);
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
            if (!href) return 'external';
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
            return cssFiles;
        }
    }

    // Selector tracking and grouping
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
                        used: false,
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
                if (!info.used) {
                    try {
                        const exists = document.querySelector(selector);
                        if (exists) {
                            info.used = true;
                        } else if (info.safe) {
                            unusedCount++;
                        }
                    } catch (error) {
                        info.used = true;
                    }
                }
            }
            state.totalUnusedCount = unusedCount;
            UIManager.updateButton(unusedCount);
        }

        static groupSelectorsByFile() {
            const grouped = {};
            for (const [selector, info] of state.unusedSelectors.entries()) {
                if (info.used) continue;
                const href = info.href;
                if (!grouped[href]) grouped[href] = [];
                grouped[href].push({ selector, media: info.media });
            }
            return grouped;
        }
    }

    // Processing CSS rules and stylesheets
    class RuleProcessor {
        static async processStyleSheet(sheet) {
            let rules;
            try {
                rules = sheet.cssRules;
            } catch (error) {
                if (error.name === 'SecurityError') {
                    rules = await this.handleCrossOriginStyleSheet(sheet);
                } else {
                    console.warn(`Не удалось получить правила:`, error);
                    return;
                }
            }
            if (!rules) return;
            for (const rule of rules) {
                await this.processRule(rule, sheet.href || 'external');
            }
        }

        static async handleCrossOriginStyleSheet(sheet) {
            if (!sheet.href || !CSSUtils.isLocalUrl(sheet.href)) {
                console.warn(`Файл недоступен: ${sheet.href}`);
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

        static async processMediaRule(mediaRule, href) {
            const mediaText = mediaRule.media.mediaText;
            for (const rule of mediaRule.cssRules) {
                if (rule.type === CSSRule.STYLE_RULE) {
                    SelectorManager.addSelector(rule.selectorText, href, mediaText);
                } else if (rule.type === CSSRule.MEDIA_RULE) {
                    await this.processMediaRule(rule, href);
                }
            }
        }
    }

    // Settings dialog and fetch/save
    class SettingsManager {
        static async loadSettings() {
            try {
                const response = await fetch(CONFIG.SERVER_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Action': 'settings'
                    },
                    body: JSON.stringify({ action: 'load' })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = await response.json();
                if (result.success && result.data && result.data.settings) {
                    return result.data.settings;
                }
                return state.settings;
            } catch (error) {
                console.warn('Ошибка загрузки настроек:', error);
                return state.settings;
            }
        }

        static async saveSettings(settings) {
            try {
                const response = await fetch(CONFIG.SERVER_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Action': 'settings'
                    },
                    body: JSON.stringify({ action: 'save', settings })
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = await response.json();
                if (result.success) {
                    state.settings = settings;
                    if (result.data && result.data.need_reload) {
                        UIManager.showNotification('Настройки изменены. Страница будет перезагружена.', 'info');
                        setTimeout(() => window.location.reload(), 2000);
                        return true;
                    }
                }
                return false;
            } catch (error) {
                console.error('Ошибка сохранения настроек:', error);
                throw error;
            }
        }

        static showSettings() {
            const overlay = document.createElement('div');
            overlay.id = CONFIG.SETTINGS_ID;
            overlay.style.cssText = `
                position:fixed;top:0;left:0;width:100%;height:100%;
                background:rgba(0,0,0,0.5);z-index:10001;display:flex;
                align-items:center;justify-content:center;`;

            const modal = document.createElement('div');
            modal.style.cssText = `
                background:white;border-radius:8px;padding:20px;
                max-width:600px;width:90%;max-height:80%;overflow-y:auto;color:#333;`;

            const title = document.createElement('h3');
            title.textContent = 'Настройки защиты селекторов';
            title.style.cssText = `margin:0 0 15px 0;color:#333;font-size:18px;`;

            const settingsList = [
                { key: 'media', label: '@media запросы' },
                { key: 'media_print', label: '@media print запросы' },
                { key: 'keyframes', label: '@keyframes анимации' },
                { key: 'font_face', label: '@font-face шрифты' },
                { key: 'import', label: '@import импорты' },
                { key: 'supports', label: '@supports поддержка' },
                { key: 'page', label: '@page печать' },
                { key: 'charset', label: '@charset кодировка' },
                { key: 'counter_style', label: '@counter-style счетчики' },
                { key: 'layer', label: '@layer слои' },
                { key: 'pseudo_classes', label: 'Псевдо-классы (:hover, :active)' },
                { key: 'pseudo_elements', label: 'Псевдо-элементы (::before, ::after)' },
                { key: 'attribute_selectors', label: 'Атрибутные селекторы [attr]' },
                { key: 'css_variables', label: 'CSS-переменные (--variable)' },
                { key: 'vendor_prefixes', label: 'Браузерные префиксы (-webkit-, -moz-)' },
                { key: 'adjacent_selectors', label: 'Соседние селекторы (+)' },
                { key: 'child_selectors', label: 'Дочерние селекторы (>)' },
                { key: 'general_siblings', label: 'Общие братские селекторы (~)' },
                { key: 'css_functions', label: 'CSS-функции (calc, var, url)' },
                { key: 'animations', label: 'Анимации и переходы' },
                { key: 'transforms', label: 'Трансформации' },
                { key: 'transitions', label: 'Переходы' },
                { key: 'percentages', label: 'Процентные значения' },
                { key: 'escapes', label: 'Экранированные символы' },
                { key: 'colors', label: 'Цветовые функции (rgb, hsl)' },
                { key: 'gradients', label: 'Градиенты' },
                { key: 'filters', label: 'Фильтры' },
                { key: 'masks', label: 'Маски и обрезка' },
                { key: 'nth_selectors', label: 'nth-селекторы' },
                { key: 'logical_selectors', label: 'Логические селекторы (not, is, where, has)' }
            ];

            modal.appendChild(title);

            settingsList.forEach(setting => {
                const item = document.createElement('div');
                item.style.cssText = `margin-bottom:10px;display:flex;align-items:center;`;

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = setting.key;
                checkbox.checked = state.settings[setting.key];
                checkbox.style.cssText = `margin-right:10px;`;

                const label = document.createElement('label');
                label.htmlFor = setting.key;
                label.textContent = setting.label;
                label.style.cssText = `cursor:pointer;flex:1;`;

                item.appendChild(checkbox);
                item.appendChild(label);
                modal.appendChild(item);
            });

            const buttons = document.createElement('div');
            buttons.style.cssText = `margin-top:20px;display:flex;gap:10px;justify-content:flex-end;`;

            const saveBtn = document.createElement('button');
            saveBtn.textContent = 'Сохранить';
            saveBtn.style.cssText = `
                padding:8px 16px;background:#27ae60;color:white;
                border:none;border-radius:4px;cursor:pointer;`;

            saveBtn.onclick = async () => {
                const newSettings = {};
                settingsList.forEach(setting => {
                    const checkbox = document.getElementById(setting.key);
                    newSettings[setting.key] = checkbox.checked;
                });
                try {
                    await SettingsManager.saveSettings(newSettings);
                    overlay.remove();
                    UIManager.showNotification('Настройки сохранены. Перезагрузка...', 'success');
                    setTimeout(() => window.location.reload(), 1000);
                } catch (error) {
                    UIManager.showNotification('Ошибка сохранения настроек', 'error');
                }
            };

            const cancelBtn = document.createElement('button');
            cancelBtn.textContent = 'Отмена';
            cancelBtn.style.cssText = `
                padding:8px 16px;background:#95a5a6;color:white;
                border:none;border-radius:4px;cursor:pointer;`;
            cancelBtn.onclick = () => overlay.remove();

            buttons.appendChild(cancelBtn);
            buttons.appendChild(saveBtn);
            modal.appendChild(buttons);
            overlay.appendChild(modal);

            overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
            document.body.appendChild(overlay);
        }
    }

    // UI: floating button, menu, notifications
    class UIManager {
        static createFloatingButton() {
            if (document.getElementById(CONFIG.BUTTON_ID)) return;

            const container = document.createElement('div');
            container.style.cssText = `position:fixed;bottom:20px;right:20px;z-index:9999;`;

            const button = document.createElement('button');
            button.id = CONFIG.BUTTON_ID;
            button.innerHTML = '0';
            button.title = 'Количество неиспользуемых CSS селекторов';
            button.style.cssText = `
                width:50px;height:50px;background-color:#e74c3c;color:white;
                border:none;border-radius:50%;font-size:14px;font-weight:bold;
                cursor:pointer;box-shadow:0 4px 8px rgba(0,0,0,0.3);
                transition:all 0.3s ease;display:flex;align-items:center;justify-content:center;`;

            const menu = document.createElement('div');
            menu.id = CONFIG.MENU_ID;
            menu.style.cssText = `
                position:absolute;bottom:60px;right:0;background:white;
                border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);
                min-width:200px;opacity:0;transform:translateY(10px);
                transition:all 0.3s ease;pointer-events:none;border:1px solid #ddd;`;

            const menuItems = [
                { text: 'Сохранить данные', action: 'save', icon: '💾' },
                { text: 'Генерировать файлы', action: 'generate', icon: '⚙️' },
                { text: 'Показать отчет', action: 'report', icon: '📊' },
                { text: 'Настройки', action: 'settings', icon: '⚙️' },
                { text: 'Детектор', action: 'detector', icon: '🔍' },
                { text: 'Краулер', action: 'crawler', icon: '🕷️' },
                { text: 'Сброс данных', action: 'reset', icon: '🔄' }
            ];

            menuItems.forEach((item, index) => {
                const menuItem = document.createElement('div');
                menuItem.style.cssText = `
                    padding:12px 16px;cursor:pointer;
                    border-bottom:${index < menuItems.length - 1 ? '1px solid #eee' : 'none'};
                    display:flex;align-items:center;gap:8px;font-size:14px;color:#333;
                    transition:background-color 0.2s ease;`;
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

            document.addEventListener('click', () => { this.hideMenu(); });
            menu.addEventListener('click', (e) => { e.stopPropagation(); });
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

            if (action === 'reset') {
                if (confirm('Вы уверены, что хотите сбросить все данные? Это действие нельзя отменить!')) {
                    state.unusedSelectors.clear();
                    state.styleSheetsInfo.clear();
                    state.totalUnusedCount = 0;
                    state.currentPageSelectors.clear();

                    if (typeof crawler === 'undefined') {
                        return;
                    }
                    
                    if (crawler.isRunning) {
                        await crawler.stop();
                    }

                    await crawler.reset();

                    this.showNotification('Данные успешно сброшены', 'success');
                }

                return;
            }

            if (action === 'crawler') {
                try {
                    if (typeof crawler === 'undefined') {
                        console.warn('SiteCrawler не инициализирован');
                        this.showNotification('Краулер не найден', 'error');
                        return;
                    }

                    const stats = await crawler.getStats();

                    if (crawler.isRunning) {
                        await crawler.stop();
                        return;
                    }

                    // Показываем подтверждение
                    const confirmMessage = `Запустить автоматический обход сайта?\n\nТекущая статистика:\n• Найдено URL: ${stats.total}\n• Обработано: ${stats.completed}\n• Ожидает: ${stats.pending}\n\nВнимание: процесс может занять много времени!`;

                    if (confirm(confirmMessage)) {
                        await crawler.start();
                        this.showNotification('Краулер запущен', 'success');
                    }
                } catch (error) {
                    console.error('Ошибка запуска краулера:', error);
                    this.showNotification('Не удалось запустить краулер', 'error');
                }
                return;
            }


            // Настройки
            if (action === 'settings') {
                SettingsManager.showSettings();
                return;
            }

            // Запуск динамического детектора
            if (action === 'detector') {
                try {
                    if (typeof detector === 'undefined') {
                        console.warn('DynamicContentDetector не инициализирован');
                        this.showNotification('Детектор не найден', 'error');
                    } else {
                        detector.start();
                        this.showNotification('Детектор запущен', 'info');
                    }
                } catch (e) {
                    console.error('Ошибка запуска детектора:', e);
                    this.showNotification('Не удалось запустить детектор', 'error');
                }
                return;
            }

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
                    this.showNotification('Селекторов для удаления не найдено', 'info');
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
                console.error('Ошибка:', error);
                this.showNotification('Произошла ошибка', 'error');
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
            let reportHtml = '<div style="font-family:monospace;font-size:12px;line-height:1.4;">';
            reportHtml += '<h3 style="margin:0 0 10px 0;color:#fff;">🔍 Отчет о неиспользуемых селекторах</h3>';
            reportHtml += '<div style="margin-bottom:10px;padding:8px;background:#f8f9fa;border-radius:4px;color:#000;">';
            reportHtml += '<strong>⚠️ Внимание:</strong> Показаны селекторы на основе текущих настроек фильтрации.';
            reportHtml += '</div>';
            for (const [file, selectors] of Object.entries(data)) {
                if (selectors.length === 0) continue;
                totalSelectors += selectors.length;
                reportHtml += `<div style="margin-bottom:10px;border:1px solid #ddd;border-radius:4px;padding:8px;">`;
                reportHtml += `<strong style="color:#fff;font-weight:bolder;">📄 ${file}</strong> (${selectors.length} селекторов)<br>`;
                const selectorList = selectors.slice(0, 10).map(s => s.selector).join(', ');
                reportHtml += `<small style="color:#fff;">${selectorList}`;
                if (selectors.length > 10) {
                    reportHtml += ` ... и еще ${selectors.length - 10}`;
                }
                reportHtml += '</small></div>';
            }
            reportHtml += `<div style="margin-top:10px;padding:8px;background:#e8f5e8;border-radius:4px;border:1px solid #4caf50;color:#000;">`;
            reportHtml += `<strong>📊 Итого: ${totalSelectors} селекторов в ${Object.keys(data).length} файлах</strong>`;
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
                    throw new Error(result.error || 'Ошибка сервера');
                }
            } catch (error) {
                console.error('Ошибка сохранения:', error);
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
                    throw new Error(result.error || 'Ошибка сервера');
                }
            } catch (error) {
                console.error('Ошибка генерации:', error);
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
                button.style.backgroundColor = count > 0 ? '#e74c3c' : '#27ae60';
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
            const colors = { success: '#27ae60', error: '#e74c3c', info: '#3498db' };
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
                closeButton.style.cssText = `position:absolute;top:10px;right:10px;background:rgba(255,255,255,0.2);border:none;color:white;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:12px;display:flex;align-items:center;justify-content:center;`;
                closeButton.addEventListener('click', () => { notification.remove(); });
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

    // Main logic: load, scan, periodic check
    class UnusedCSSDetector {
        static async init() {
            try {
                state.settings = await SettingsManager.loadSettings();
                state.currentPageSelectors = CSSUtils.getCurrentPageCSSFiles();
                await this.loadStyleSheets();
                UIManager.createFloatingButton();
                this.startPeriodicCheck();
                console.log('Remove Unused CSS загружен');
                console.log('CSS файлы:', Array.from(state.currentPageSelectors));
                console.log('Селекторов найдено:', state.unusedSelectors.size);
                const safeCount = Array.from(state.unusedSelectors.values()).filter(info => info.safe).length;
                console.log('Проверяемых:', safeCount);
                window.unusedCSSState = state;
            } catch (error) {
                console.error('Ошибка инициализации:', error);
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
                    console.warn('Ошибка обработки:', sheet.href, error);
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

    // DOM changes tracking
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



    class SiteCrawler {
        constructor() {
            this.db = null;
            this.isRunning = false;
            this.currentDepth = 0;
            this.crawledCount = 0;
            this.totalFound = 0;
            this.currentUrl = '';
            this.startUrl = window.location.origin;
            this.urlQueue = new Set();
            this.processedUrls = new Set();
            this.errors = [];
            this.baseUrl = window.location.origin;
        }


        async checkUrlAvailability(url) {
            try {
                this.log(`🔍 Проверка доступности: ${url}`, 'debug');

                // Используем fetch с методом HEAD для экономии трафика
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 сек таймаут

                const response = await fetch(url, {
                    method: 'HEAD',
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; SiteCrawler/1.0)',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    },
                    credentials: 'same-origin',
                    redirect: 'follow'
                });

                clearTimeout(timeoutId);

                const result = {
                    isValid: response.ok,
                    status: response.status,
                    error: null,
                    redirected: response.redirected,
                    finalUrl: response.url
                };

                if (!response.ok) {
                    result.error = `HTTP ${response.status} ${response.statusText}`;
                    this.log(`❌ URL недоступен: ${url} (${response.status})`, 'debug');
                } else {
                    this.log(`✅ URL доступен: ${url} (${response.status})`, 'debug');
                }

                return result;

            } catch (error) {
                const result = {
                    isValid: false,
                    status: 0,
                    error: error.name === 'AbortError' ? 'Timeout' : error.message,
                    redirected: false,
                    finalUrl: url
                };

                this.log(`❌ Ошибка проверки URL ${url}: ${error.message}`, 'debug');
                return result;
            }
        }

        isValidCrawlableUrl(url) {
            try {
                const urlObj = new URL(url);

                // Проверка протокола
                if (!['http:', 'https:'].includes(urlObj.protocol)) {
                    this.log(`🚫 Неподдерживаемый протокол: ${url}`, 'debug');
                    return false;
                }

                // Проверка домена
                if (urlObj.hostname !== new URL(this.baseUrl).hostname) {
                    this.log(`🚫 Внешний домен: ${url}`, 'debug');
                    return false;
                }

                // Проверка длины URL
                if (url.length > 2000) {
                    this.log(`🚫 URL слишком длинный: ${url}`, 'debug');
                    return false;
                }

                // Проверка на подозрительные параметры
                const suspiciousParams = ['token', 'session', 'auth', 'key', 'password'];
                const hasSecret = suspiciousParams.some(param =>
                    urlObj.searchParams.has(param) || url.toLowerCase().includes(param)
                );

                if (hasSecret) {
                    this.log(`🚫 URL содержит подозрительные параметры: ${url}`, 'debug');
                    return false;
                }

                return true;

            } catch (error) {
                this.log(`❌ Ошибка валидации URL ${url}: ${error.message}`, 'debug');
                return false;
            }
        }


        async init() {
            try {
                await this.initIndexedDB();
                await this.loadCrawlerStatus();
                this.log('🕷️ Crawler инициализирован');
                return true;
            } catch (error) {
                this.handleError('Ошибка инициализации Crawler', error);
                return false;
            }
        }

        async initIndexedDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(CONFIG.CRAWLER_DB_NAME, CONFIG.CRAWLER_DB_VERSION);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    this.db = request.result;
                    resolve();
                };

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;

                    // Создаем хранилище для URL-ов
                    if (!db.objectStoreNames.contains(CONFIG.CRAWLER_STORE_NAME)) {
                        const store = db.createObjectStore(CONFIG.CRAWLER_STORE_NAME, {
                            keyPath: 'url'
                        });
                        store.createIndex('status', 'status', { unique: false });
                        store.createIndex('depth', 'depth', { unique: false });
                        store.createIndex('foundOn', 'foundOn', { unique: false });
                    }
                };
            });
        }

        async saveUrlToDB(url, depth = 0, foundOn = '', status = 'pending') {
            if (!this.db) return false;

            try {
                const transaction = this.db.transaction([CONFIG.CRAWLER_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(CONFIG.CRAWLER_STORE_NAME);

                const urlData = {
                    url: url,
                    depth: depth,
                    foundOn: foundOn,
                    status: status,
                    timestamp: Date.now(),
                    processed: false
                };

                await new Promise((resolve, reject) => {
                    const request = store.put(urlData);
                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });

                return true;
            } catch (error) {
                this.handleError('Ошибка сохранения URL в БД', error);
                return false;
            }
        }

        async getNextUrlFromDB() {
            if (!this.db) return null;

            try {
                const transaction = this.db.transaction([CONFIG.CRAWLER_STORE_NAME], 'readonly');
                const store = transaction.objectStore(CONFIG.CRAWLER_STORE_NAME);
                const index = store.index('status');

                return new Promise((resolve, reject) => {
                    const request = index.openCursor(IDBKeyRange.only('pending'));
                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            resolve(cursor.value);
                        } else {
                            resolve(null);
                        }
                    };
                    request.onerror = () => reject(request.error);
                });
            } catch (error) {
                this.handleError('Ошибка получения URL из БД', error);
                return null;
            }
        }

        async markUrlAsProcessed(url, status = 'completed') {
            if (!this.db) return false;

            try {
                const transaction = this.db.transaction([CONFIG.CRAWLER_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(CONFIG.CRAWLER_STORE_NAME);

                const getRequest = store.get(url);
                getRequest.onsuccess = () => {
                    const urlData = getRequest.result;
                    if (urlData) {
                        urlData.status = status;
                        urlData.processed = true;
                        urlData.processedAt = Date.now();
                        store.put(urlData);
                    }
                };

                return true;
            } catch (error) {
                this.handleError('Ошибка обновления статуса URL', error);
                return false;
            }
        }

        async getAllUrlsFromDB() {
            if (!this.db) return [];

            try {
                const transaction = this.db.transaction([CONFIG.CRAWLER_STORE_NAME], 'readonly');
                const store = transaction.objectStore(CONFIG.CRAWLER_STORE_NAME);

                return new Promise((resolve, reject) => {
                    const request = store.getAll();
                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                });
            } catch (error) {
                this.handleError('Ошибка получения всех URL', error);
                return [];
            }
        }


        async loadCrawlerStatus() {
            try {
                const status = localStorage.getItem(CONFIG.CRAWLER_STATUS_KEY);
                if (status) {
                    const parsed = JSON.parse(status);
                    this.isRunning = parsed.isRunning || false;
                    this.crawledCount = parsed.crawledCount || 0;
                    this.currentDepth = parsed.currentDepth || 0;

                    // Если краулер был запущен, но страница перезагрузилась
                    if (this.isRunning) {
                        this.log('🔄 Продолжение работы краулера после перезагрузки');

                        // Обрабатываем текущую страницу и продолжаем
                        setTimeout(async () => {
                            await this.processCurrentPage();
                            await this.continueCrawling();
                        }, 2000);
                    }
                }
            } catch (error) {
                this.handleError('Ошибка загрузки статуса краулера', error);
            }
        }



        saveCrawlerStatus() {
            try {
                const status = {
                    isRunning: this.isRunning,
                    crawledCount: this.crawledCount,
                    currentDepth: this.currentDepth,
                    timestamp: Date.now()
                };
                localStorage.setItem(CONFIG.CRAWLER_STATUS_KEY, JSON.stringify(status));
            } catch (error) {
                this.handleError('Ошибка сохранения статуса краулера', error);
            }
        }

        async start() {
            if (this.isRunning) {
                this.log('⚠️ Краулер уже запущен');
                return;
            }

            this.log('🚀 Запуск краулера сайта...');
            this.isRunning = true;
            this.crawledCount = 0;
            this.currentDepth = 0;
            this.saveCrawlerStatus();

            try {
                // Обрабатываем текущую страницу СРАЗУ, не добавляя в очередь
                this.log('🔍 Обработка стартовой страницы...');
                await this.discoverLinksOnCurrentPage();


                if (typeof detector !== 'undefined') {
                    this.log('🤖 Запуск детектора на стартовой странице...');
                    await new Promise(resolve => {
                        const originalOnComplete = detector.options.onComplete;
                        detector.options.onComplete = (results) => {
                            if (originalOnComplete) originalOnComplete(results);
                            resolve();
                        };
                        detector.start();
                    });
                    this.log('✅ Детектор завершил работу на стартовой странице');
                }


                // Помечаем текущую страницу как обработанную
                const currentUrl = this.cleanUrl(window.location.href);
                await this.markUrlAsProcessed(currentUrl, 'completed');
                this.crawledCount++;
                this.saveCrawlerStatus();

                // Продолжаем краулинг с найденными ссылками
                await this.continueCrawling();

            } catch (error) {
                this.handleError('Ошибка запуска краулера', error);
                this.stop();
            }
        }



        async continueCrawling() {
            if (!this.isRunning) return;

            this.log(`📊 Текущий статус: обработано ${this.crawledCount} страниц`);

            if (this.crawledCount >= CONFIG.MAX_URLS_PER_SESSION) {
                this.log('🛑 Достигнут лимит страниц за сессию');
                this.stop();
                return;
            }

            // Получаем следующий URL из БД
            const nextUrlData = await this.getNextUrlFromDB();

            if (!nextUrlData) {
                this.log('✅ Краулинг завершен - все доступные страницы обработаны');
                this.stop();
                return;
            }

            const nextUrl = nextUrlData.url;
            this.log(`🔍 Найден следующий URL: ${nextUrl}`);

            // Проверяем доступность URL перед переходом
            const availability = await this.checkUrlAvailability(nextUrl);

            if (!availability.isValid) {
                this.log(`❌ URL недоступен: ${nextUrl} - ${availability.error || `Status: ${availability.status}`}`);

                // Помечаем URL как недоступный
                await this.markUrlAsProcessed(nextUrl, `error_${availability.status}`);

                // Записываем ошибку в статистику
                this.handleError(`Недоступный URL: ${nextUrl}`, new Error(availability.error || `HTTP ${availability.status}`));

                // Продолжаем с следующим URL
                setTimeout(() => this.continueCrawling(), 1000);
                return;
            }

            // Если URL был перенаправлен, обновляем информацию
            if (availability.redirected && availability.finalUrl !== nextUrl) {
                this.log(`🔄 Обнаружено перенаправление: ${nextUrl} → ${availability.finalUrl}`);

                // Проверяем, не ведет ли редирект на внешний сайт
                if (!this.isValidCrawlableUrl(availability.finalUrl)) {
                    this.log(`🚫 Редирект ведет на внешний ресурс: ${availability.finalUrl}`);
                    await this.markUrlAsProcessed(nextUrl, 'redirect_external');
                    setTimeout(() => this.continueCrawling(), 1000);
                    return;
                }

                // Сохраняем информацию о редиректе
                await this.saveUrlToDB(availability.finalUrl, nextUrlData.depth, nextUrl, 'pending');
                await this.markUrlAsProcessed(nextUrl, 'redirect_processed');
            }

            this.log(`🌐 Переход на проверенную страницу: ${nextUrl}`);

            // Устанавливаем обработчик для случая, если страница не загрузится
            const navigationTimeout = setTimeout(() => {
                this.log('⚠️ Таймаут загрузки страницы, продолжаем краулинг');
                this.handleError('Таймаут навигации', new Error(`Страница не загрузилась: ${nextUrl}`));
            }, 15000); // 15 секунд на загрузку

            // Сохраняем информацию о текущем переходе
            this.currentUrl = nextUrl;
            this.saveCrawlerStatus();

            try {
                // Переходим на страницу
                setTimeout(() => {
                    clearTimeout(navigationTimeout);
                    window.location.href = nextUrl;
                }, CONFIG.CRAWL_DELAY);

            } catch (error) {
                clearTimeout(navigationTimeout);
                this.handleError('Ошибка навигации', error);
                await this.markUrlAsProcessed(nextUrl, 'navigation_error');
                setTimeout(() => this.continueCrawling(), CONFIG.CRAWL_DELAY);
            }
        }



        async processCurrentPage() {
            this.log('🔍 Обработка текущей страницы...');

            try {
                const currentUrl = this.cleanUrl(window.location.href);

                // Проверяем страницу на ошибки
                /*
                const pageCheck = await this.checkCurrentPageForErrors();
                if (pageCheck.hasError) {
                    this.log(`❌ Обнаружена ошибка на странице: ${pageCheck.errorType}`);
                    await this.markUrlAsProcessed(currentUrl, `page_error_${pageCheck.errorType}`);
                    this.crawledCount++;
                    this.saveCrawlerStatus();
                    return;
                }
                */

                // Помечаем URL как обрабатываемый
                await this.markUrlAsProcessed(currentUrl, 'processing');

                // Ищем ссылки на странице
                await this.discoverLinksOnCurrentPage();

                // Запускаем детектор, если доступен
                if (typeof detector !== 'undefined') {
                    this.log('🤖 Запуск динамического детектора...');

                    return new Promise((resolve) => {
                        const originalOnComplete = detector.options.onComplete;

                        detector.options.onComplete = (results) => {
                            this.log('✅ Детектор завершил работу', results);

                            if (originalOnComplete) {
                                originalOnComplete(results);
                            }

                            // Помечаем как успешно обработанный
                            this.markUrlAsProcessed(currentUrl, 'completed');
                            this.crawledCount++;
                            this.saveCrawlerStatus();
                            resolve();
                        };

                        detector.start();
                    });
                } else {
                    this.log('⚠️ Детектор не найден, продолжаем без него');
                    await this.markUrlAsProcessed(currentUrl, 'completed');
                    this.crawledCount++;
                    this.saveCrawlerStatus();
                }

            } catch (error) {
                this.handleError('Ошибка обработки текущей страницы', error);
                const currentUrl = this.cleanUrl(window.location.href);
                await this.markUrlAsProcessed(currentUrl, 'processing_error');
                this.crawledCount++;
                this.saveCrawlerStatus();
            }
        }



        async discoverLinksOnCurrentPage() {
            const currentUrl = window.location.href;
            const currentCleanUrl = this.cleanUrl(currentUrl);
            const foundLinks = new Set();

            // Получаем все ссылки на странице
            const links = document.querySelectorAll('a[href]');
            this.log(`🔗 Найдено ${links.length} ссылок на странице`);

            // Массив для батч-проверки URL
            const urlsToCheck = [];

            for (const link of links) {
                try {
                    const href = link.getAttribute('href');
                    if (!href || href.trim() === '') continue;

                    // Создаем абсолютный URL
                    let absoluteUrl;
                    try {
                        absoluteUrl = new URL(href, currentUrl).href;
                    } catch (urlError) {
                        this.log(`⚠️ Некорректный URL: ${href}`, 'debug');
                        continue;
                    }

                    // Первичная валидация
                    if (!this.isValidCrawlableUrl(absoluteUrl)) {
                        continue;
                    }

                    const cleanUrl = this.cleanUrl(absoluteUrl);

                    // Пропускаем текущую страницу
                    if (cleanUrl === currentCleanUrl) {
                        this.log(`🔄 Пропуск текущей страницы: ${cleanUrl}`, 'debug');
                        continue;
                    }

                    // Проверяем паттерны исключений
                    if (this.shouldSkipUrl(cleanUrl)) {
                        this.log(`🚫 URL пропущен по паттерну: ${cleanUrl}`, 'debug');
                        continue;
                    }

                    // Проверяем, нет ли уже в базе
                    const existing = await this.getUrlFromDB(cleanUrl);
                    if (!existing) {
                        foundLinks.add(cleanUrl);
                        urlsToCheck.push(cleanUrl);
                        this.log(`✅ Новая ссылка найдена: ${cleanUrl}`, 'debug');
                    } else {
                        this.log(`🔄 URL уже в базе: ${cleanUrl}`, 'debug');
                    }

                } catch (error) {
                    this.log(`❌ Ошибка обработки ссылки ${link.getAttribute('href')}: ${error.message}`, 'debug');
                    continue;
                }
            }

            // Батч-проверка доступности новых URL (проверяем только первые 20)
            // const urlsToValidate = urlsToCheck.slice(0, 20);
            const urlsToValidate = urlsToCheck;
            this.log(`🔍 Проверка доступности ${urlsToValidate.length} новых URL`);

            let savedCount = 0;
            let checkedCount = 0;

            for (const url of urlsToValidate) {
                try {
                    checkedCount++;
                    this.log(`🔍 Проверка ${checkedCount}/${urlsToValidate.length}: ${url}`, 'debug');

                    const availability = await this.checkUrlAvailability(url);

                    if (availability.isValid) {
                        // URL доступен, сохраняем в БД
                        const finalUrl = availability.redirected ? availability.finalUrl : url;
                        const saved = await this.saveUrlToDB(finalUrl, this.currentDepth + 1, currentUrl, 'pending');

                        if (saved) {
                            savedCount++;
                            this.log(`✅ URL сохранен: ${finalUrl}`, 'debug');
                        } else {
                            this.log(`⚠️ Не удалось сохранить URL: ${finalUrl}`, 'debug');
                        }

                        // Если был редирект, сохраняем оригинальный URL как обработанный
                        if (availability.redirected && finalUrl !== url) {
                            await this.saveUrlToDB(url, this.currentDepth + 1, currentUrl, 'redirect_processed');
                        }

                    } else {
                        // URL недоступен, сохраняем с соответствующим статусом
                        await this.saveUrlToDB(url, this.currentDepth + 1, currentUrl, `error_${availability.status}`);
                        this.log(`❌ URL недоступен (${availability.status}): ${url}`, 'debug');
                    }

                    // Небольшая пауза между проверками
                    await new Promise(resolve => setTimeout(resolve, 200));

                } catch (error) {
                    this.handleError(`Ошибка проверки URL ${url}`, error);
                    // Сохраняем URL с ошибкой для возможной повторной обработки
                    await this.saveUrlToDB(url, this.currentDepth + 1, currentUrl, 'check_error');
                }
            }

            // Остальные URL сохраняем без проверки (будут проверены при обработке)
            //const remainingUrls = urlsToCheck.slice(20);
            //for (const url of remainingUrls) {
            //const saved = await this.saveUrlToDB(url, this.currentDepth + 1, currentUrl, 'pending');
            //if (saved) savedCount++;
            //}

            this.log(`🔗 Найдено ${foundLinks.size} уникальных ссылок`);
            this.log(`✅ Проверено на доступность: ${checkedCount}`);
            this.log(`💾 Сохранено в базу: ${savedCount} новых URL`);

            this.totalFound += savedCount;
        }


        async getUrlFromDB(url) {
            if (!this.db) return null;

            try {
                const transaction = this.db.transaction([CONFIG.CRAWLER_STORE_NAME], 'readonly');
                const store = transaction.objectStore(CONFIG.CRAWLER_STORE_NAME);

                return new Promise((resolve, reject) => {
                    const request = store.get(url);
                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            } catch (error) {
                this.handleError('Ошибка получения URL из БД', error);
                return null;
            }
        }



        cleanUrl(url) {
            try {
                const urlObj = new URL(url);

                // Убираем якорь
                urlObj.hash = '';

                // Убираем tracking параметры
                const paramsToRemove = [
                    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
                    'fbclid', 'gclid', 'dclid', 'msclkid', 'twclid',
                    'ref', 'source', 'campaign', 'medium'
                ];

                paramsToRemove.forEach(param => {
                    urlObj.searchParams.delete(param);
                });

                // Нормализуем путь (убираем двойные слеши, лишние точки)
                let pathname = urlObj.pathname;
                pathname = pathname.replace(/\/+/g, '/'); // заменяем множественные слеши на одинарные
                //pathname = pathname.replace(/\/\.$/, '/'); // убираем /. в конце
                //pathname = pathname.replace(/\/\.\//g, '/'); // убираем /./ в середине

                // Если путь заканчивается на index.html, index.php и т.п. - убираем
                // pathname = pathname.replace(/\/(index\.(html?|php)|default\.(html?|php|asp|aspx))$/i, '/');

                urlObj.pathname = pathname;

                return urlObj.href;
            } catch (error) {
                this.log(`❌ Ошибка очистки URL ${url}: ${error.message}`, 'debug');
                return url;
            }
        }


        shouldSkipUrl(url) {
            const skipPatterns = [
                // Файлы
                /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|tar|gz|7z)$/i,
                /\.(jpg|jpeg|png|gif|svg|ico|webp|bmp|tiff?)$/i,
                /\.(css|js|json|xml|txt|csv)$/i,
                /\.(mp3|mp4|avi|mov|wmv|flv|webm|ogg|wav)$/i,
                /\.(woff2?|ttf|eot|otf)$/i,

                // Служебные пути
                /\/wp-admin\//i,
                /\/admin\//i,
                /\/login\//i,
                /\/logout\//i,
                /\/register\//i,
                /\/api\//i,
                /\/ajax\//i,
                /\/cgi-bin\//i,
                /\/download\//i,
                /\/uploads?\//i,
                /\/assets?\//i,
                /\/static\//i,
                /\/media\//i,

                // Протоколы
                /^mailto:/i,
                /^tel:/i,
                /^fax:/i,
                /^javascript:/i,
                /^data:/i,

                // Специальные случаи
                /#$/,           // только якорь
                /\?print=1/i,   // версия для печати
                /\?pdf=1/i,     // PDF версия
                /\/print\//i,   // страницы печати
            ];

            return skipPatterns.some(pattern => pattern.test(url));
        }

        stop() {
            this.log('🛑 Остановка краулера...');
            this.isRunning = false;
            this.saveCrawlerStatus();

            // Показываем статистику
            this.showFinalStats();
        }



        async reset() {
            // 1) остановить, если запущен
            this.isRunning = false;

            // 2) удалить IndexedDB
            const dbDeleteReq = indexedDB.deleteDatabase(CONFIG.CRAWLER_DB_NAME);
            dbDeleteReq.onsuccess = () => console.log('IndexedDB удалена');
            dbDeleteReq.onerror = () => console.error('Ошибка при удалении IndexedDB');

            // 3) очистить localStorage
            localStorage.removeItem('crawlerStatus');

            // 4) очистить внутренние структуры
            this.crawledCount = 0;
            this.errors = [];

            console.log('Краулер сброшен в начальное состояние');
        }

        async showFinalStats() {
            const allUrls = await this.getAllUrlsFromDB();
            const completed = allUrls.filter(u => u.status === 'completed').length;
            const pending = allUrls.filter(u => u.status === 'pending').length;

            const stats = `
🕷️ СТАТИСТИКА КРАУЛЕРА:
━━━━━━━━━━━━━━━━━━━━━━
📊 Всего найдено URL: ${allUrls.length}
✅ Обработано страниц: ${completed}
⏳ Ожидают обработки: ${pending}
🚫 Ошибок: ${this.errors.length}
⏱️ Сессия завершена
            `;

            this.log(stats);

            // Показываем уведомление
            if (typeof UIManager !== 'undefined') {
                UIManager.showLargeNotification(stats, 'info', false);
            }
        }

        async getStats() {
            const allUrls = await this.getAllUrlsFromDB();
            return {
                total: allUrls.length,
                completed: allUrls.filter(u => u.status === 'completed').length,
                pending: allUrls.filter(u => u.status === 'pending').length,
                errors: this.errors.length,
                isRunning: this.isRunning
            };
        }

        handleError(message, error) {
            const errorInfo = {
                message,
                error: error.message,
                url: window.location.href,
                timestamp: new Date().toISOString()
            };

            this.errors.push(errorInfo);
            this.log(`❌ ${message}: ${error.message}`, 'error');
        }


        async checkCurrentPageForErrors() {
            try {
                // Проверяем заголовок страницы на наличие ошибок
                const title = document.title.toLowerCase();
                const errorTitles = ['404', '403', '500', 'error', 'not found', 'access denied', 'server error'];

                const hasErrorInTitle = errorTitles.some(errorText => title.includes(errorText));

                if (hasErrorInTitle) {
                    return { hasError: true, errorType: 'error_in_title' };
                }

                // Проверяем основной контент на наличие сообщений об ошибках
                const bodyText = document.body.textContent.toLowerCase();
                const errorMessages = [
                    '404', '403', '500', '502', '503', '504',
                    'not found', 'page not found', 'file not found',
                    'access denied', 'forbidden', 'unauthorized',
                    'internal server error', 'service unavailable',
                    'bad gateway', 'gateway timeout'
                ];

                const hasErrorInContent = errorMessages.some(errorMsg => bodyText.includes(errorMsg));

                if (hasErrorInContent) {
                    return { hasError: true, errorType: 'error_in_content' };
                }

                // Проверяем наличие основного контента
                const contentElements = document.querySelectorAll('main, article, .content, #content, .main');
                const hasMainContent = contentElements.length > 0 &&
                    Array.from(contentElements).some(el => el.textContent.trim().length > 100);

                if (!hasMainContent && document.body.textContent.trim().length < 200) {
                    return { hasError: true, errorType: 'insufficient_content' };
                }

                return { hasError: false, errorType: null };

            } catch (error) {
                this.log(`⚠️ Ошибка проверки страницы на ошибки: ${error.message}`, 'debug');
                return { hasError: false, errorType: null };
            }
        }

        log(message, type = 'info') {
            const prefix = {
                info: '🕷️',
                success: '✅',
                error: '❌',
                debug: '🐛'
            }[type] || '🕷️';

            console.log(`${prefix} [SiteCrawler] ${message}`);
        }
    }



    let crawler;


    // Start app
    function startApp() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                UnusedCSSDetector.init();
                DOMChangeHandler.init();

                (async () => { // Инициализация краулера
                    crawler = new SiteCrawler();
                    const initialized = await crawler.init();
                    if (initialized) {
                        console.log('🕷️ SiteCrawler готов к работе');
                    } else {
                        console.warn('⚠️ SiteCrawler не удалось инициализировать');
                    }
                })();
            });
        } else {
            UnusedCSSDetector.init();
            DOMChangeHandler.init();

            (async () => { // Инициализация краулера
                crawler = new SiteCrawler();
                const initialized = await crawler.init();
                if (initialized) {
                    console.log('🕷️ SiteCrawler готов к работе');
                } else {
                    console.warn('⚠️ SiteCrawler не удалось инициализировать');
                }
            })();
        }
    }

    /**
     * Dynamic Content Detector
     * Автоматический обход всех интерактивных элементов на странице
     * для максимального выявления используемых CSS селекторов
     */

    class DynamicContentDetector {
        constructor(options = {}) {
            this.options = {
                // Задержки между действиями (мс)
                mouseDelay: 150,           // пауза после hover-эффекта
                clickDelay: 300,           // пауза после клика
                inputDelay: 200,           // пауза после ввода в поля
                scrollDelay: 500,          // пауза после прокрутки страницы
                observerDelay: 1000,       // пауза между срабатываниями MutationObserver

                // Глубина вложенности для поиска новых элементов
                maxDepth: 10,              // сколько уровней вложенности проверяем

                // Максимальное время ожидания динамического контента
                maxWaitTime: 5000,         // максимально ждём появления контента

                // Включить/отключить типы взаимодействий
                enableHover: true,         // эмулировать наведение курсора
                enableClick: false,        // эмулировать клики (false — без кликов)
                enableFocus: true,         // эмулировать фокус на элементах
                enableScroll: true,        // эмулировать прокрутку
                enableResize: true,        // эмулировать изменение размеров окна
                enableKeyboard: true,      // эмулировать клавиатурные события
                disableNavigation: true,   // блокировать реальные переходы по ссылкам

                // Дополнительные настройки
                simulateDeviceResize: true,    // менять viewport для разных устройств
                triggerCustomEvents: true,     // триггерить события load, scroll, resize и др.
                checkInvisibleElements: true,  // проверять скрытые элементы (display:none)

                // Колбэки для отслеживания прогресса
                onProgress: null,         // вызывается при каждом шаге сканирования
                onComplete: null,         // вызывается по завершении всего обхода
                onError: null,            // вызывается при ошибках во время сканирования

                autoSave: true,           // сохранять автоматически неиспользуемые правила по завершении всего обхода

                ...options                // переопределение значений из переданного объекта
            };


            this.state = {
                isRunning: false,
                processedElements: new Set(),
                discoveredElements: new Set(),
                initialElementsCount: 0,
                currentStep: '',
                progress: 0,
                errors: []
            };

            this.selectors = {
                // Интерактивные элементы
                interactive: [
                    'button', 'input', 'textarea', 'select', 'a',
                    '[onclick]', '[onmouseover]', '[onmouseenter]', '[onmouseleave]',
                    '[onfocus]', '[onblur]', '[onchange]', '[onsubmit]',
                    '[tabindex]', '[role="button"]', '[role="tab"]', '[role="menuitem"]'
                ],

                // Элементы с состояниями
                stateful: [
                    '.active', '.selected', '.expanded', '.collapsed', '.open', '.closed',
                    '.visible', '.hidden', '.show', '.hide', '.current', '.disabled'
                ],

                // Популярные UI компоненты
                components: [
                    '.modal', '.popup', '.dropdown', '.tooltip', '.accordion', '.tab',
                    '.slider', '.carousel', '.gallery', '.menu', '.navbar', '.sidebar',
                    '.overlay', '.dialog', '.panel', '.card', '.widget', '.component'
                ],

                // Hover элементы
                hoverable: [
                    'a', 'button', '.btn', '.link', '.hover', '[title]',
                    '.menu-item', '.nav-item', '.card', '.thumbnail', 'img'
                ],

                // Форм элементы
                forms: [
                    'input[type="text"]', 'input[type="email"]', 'input[type="password"]',
                    'input[type="number"]', 'input[type="tel"]', 'input[type="url"]',
                    'input[type="search"]', 'input[type="checkbox"]', 'input[type="radio"]',
                    'textarea', 'select', 'form'
                ],

                // Медиа элементы
                media: [
                    'video', 'audio', 'iframe', 'object', 'embed',
                    '.video-player', '.audio-player', '.media-container'
                ]
            };

            this.observer = null;
            this.progressCallback = null;

            this.originalHandlers = new Map();
            this.preventedEvents = new Set();
            this.isNavigationBlocked = false;
        }


        // Метод для блокировки навигации
        blockNavigation() {
            if (this.isNavigationBlocked) return;

            this.isNavigationBlocked = true;
            this.log("🛡️ Блокировка навигации активирована");

            // Блокируем события на document
            const eventsToBlock = ['beforeunload', 'unload', 'pagehide'];
            eventsToBlock.forEach(eventType => {
                const handler = (e) => {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    return false;
                };
                document.addEventListener(eventType, handler, true);
                this.originalHandlers.set(eventType, handler);
            });

            // Блокируем отправку форм
            document.addEventListener('submit', (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.log("🚫 Заблокирована отправка формы");
                return false;
            }, true);

            // Перехватываем clicks на ссылках
            document.addEventListener('click', (e) => {
                const target = e.target.closest('a');
                if (target && target.href) {
                    // Проверяем тип ссылки
                    const href = target.href.toLowerCase();
                    const isExternal = href.startsWith('http') && !href.includes(window.location.hostname);
                    const isJavaScript = href.startsWith('javascript:');
                    const isAnchor = href.includes('#') && href.split('#')[0] === window.location.href.split('#')[0];
                    const isMailto = href.startsWith('mailto:');
                    const isTel = href.startsWith('tel:');

                    // Разрешаем только якоря на текущей странице
                    if (!isAnchor && !isJavaScript && !isMailto && !isTel) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        this.log(`🚫 Заблокирован переход по ссылке: ${target.href}`);
                        return false;
                    }
                }
            }, true);

            // Блокируем изменение location
            const originalPushState = history.pushState;
            const originalReplaceState = history.replaceState;

            history.pushState = function () {
                console.log("🚫 Заблокирован pushState");
                return false;
            };

            history.replaceState = function () {
                console.log("🚫 Заблокирован replaceState");
                return false;
            };

            this.originalHandlers.set('pushState', originalPushState);
            this.originalHandlers.set('replaceState', originalReplaceState);
        }

        // Метод для разблокировки навигации
        unblockNavigation() {
            if (!this.isNavigationBlocked) return;

            this.log("🔓 Разблокировка навигации");

            // Восстанавливаем оригинальные обработчики
            this.originalHandlers.forEach((handler, eventType) => {
                if (eventType === 'pushState') {
                    history.pushState = handler;
                } else if (eventType === 'replaceState') {
                    history.replaceState = handler;
                } else {
                    document.removeEventListener(eventType, handler, true);
                }
            });

            this.originalHandlers.clear();
            this.isNavigationBlocked = false;
        }

        // Безопасный метод эмуляции клика
        safeClick(element) {
            if (!element) return false;

            const tagName = element.tagName.toLowerCase();
            const type = element.type?.toLowerCase();

            try {
                // Для ссылок - только эмуляция без перехода
                if (tagName === 'a') {
                    this.simulateVisualClick(element);
                    return true;
                }

                // Для форм - предотвращаем отправку
                if (tagName === 'form' || type === 'submit') {
                    this.simulateVisualClick(element);
                    return true;
                }

                // Для кнопок - безопасный клик
                if (tagName === 'button' || type === 'button') {
                    // Проверяем на деструктивные действия
                    if (this.isDestructiveElement(element)) {
                        this.simulateVisualClick(element);
                        return true;
                    }

                    // Безопасный клик для обычных кнопок
                    const clickEvent = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    });

                    element.dispatchEvent(clickEvent);
                    return true;
                }

                // Для других элементов
                this.simulateVisualClick(element);
                return true;

            } catch (error) {
                this.handleError('Ошибка безопасного клика', error, element);
                return false;
            }
        }

        // Визуальная симуляция клика без реального выполнения
        simulateVisualClick(element) {
            if (!element) return;

            try {
                // Эмулируем визуальные эффекты клика
                const originalStyle = {
                    transform: element.style.transform,
                    opacity: element.style.opacity,
                    backgroundColor: element.style.backgroundColor
                };

                // Визуальная обратная связь
                element.style.transform = 'scale(0.95)';
                element.style.opacity = '0.8';

                // Диспатчим события мыши для CSS эффектов
                this.dispatchMouseEvent(element, 'mousedown');

                setTimeout(() => {
                    this.dispatchMouseEvent(element, 'mouseup');

                    // Восстанавливаем стиль
                    Object.keys(originalStyle).forEach(prop => {
                        element.style[prop] = originalStyle[prop];
                    });
                }, 100);

                // Добавляем в обработанные
                this.state.processedElements.add(element);

            } catch (error) {
                this.handleError('Ошибка визуальной симуляции', error, element);
            }
        }

        /**
         * Главный метод запуска автоматического обхода
         */
        async start() {
            if (this.state.isRunning) {
                console.warn("DynamicContentDetector уже запущен");
                return;
            }

            console.log("🚀 Запуск автоматического обхода элементов...");
            this.state.isRunning = true;
            this.state.initialElementsCount = document.querySelectorAll("*").length;

            try {
                // Блокируем навигацию если включена опция
                if (this.options.disableNavigation) {
                    this.blockNavigation();
                }

                await this.setupObserver();
                await this.performFullScan();

                this.state.isRunning = false;
                this.log("✅ Автоматический обход завершен успешно", "success");

                if (this.options.onComplete) {
                    this.options.onComplete(this.getResults());
                }

            } catch (error) {
                this.state.isRunning = false;
                this.handleError("Критическая ошибка при обходе", error);
            } finally {
                // Всегда разблокируем навигацию
                if (this.isNavigationBlocked) {
                    this.unblockNavigation();
                }
            }
        }

        /**
         * Полный скан всех элементов на странице
         */
        async performFullScan() {
            const steps = [
                { name: 'Подготовка к сканированию', method: 'prepareScanning' },
                { name: 'Симуляция изменения размеров экрана', method: 'simulateDeviceResize' },
                { name: 'Активация hover эффектов', method: 'triggerHoverEffects' },
                { name: 'Взаимодействие с кликабельными элементами', method: 'interactWithClickables' },
                { name: 'Работа с формами', method: 'interactWithForms' },
                { name: 'Прокрутка и ленивая загрузка', method: 'performScrolling' },
                { name: 'Симуляция клавиатурной навигации', method: 'simulateKeyboardNavigation' },
                { name: 'Активация медиа элементов', method: 'activateMediaElements' },
                { name: 'Поиск скрытых элементов', method: 'revealHiddenElements' },
                { name: 'Триггер кастомных событий', method: 'triggerCustomEvents' },
                { name: 'Финальная проверка', method: 'finalCheck' }
            ];

            for (let i = 0; i < steps.length; i++) {
                const step = steps[i];
                this.updateProgress(step.name, (i / steps.length) * 100);

                try {
                    await this[step.method]();
                    await this.delay(this.options.observerDelay);
                } catch (error) {
                    this.handleError(`Ошибка на этапе "${step.name}"`, error);
                }
            }
        }

        /**
         * Подготовка к сканированию
         */
        async prepareScanning() {
            // Убираем все активные состояния
            document.querySelectorAll('.active, .selected, .current, .focus').forEach(el => {
                el.classList.remove('active', 'selected', 'current', 'focus');
            });

            // Сбрасываем все формы
            document.querySelectorAll('form').forEach(form => {
                try { form.reset(); } catch (e) { }
            });

            await this.delay(this.options.mouseDelay);
        }

        /**
         * Симуляция изменения размеров экрана
         */
        async simulateDeviceResize() {
            if (!this.options.simulateDeviceResize) return;

            const sizes = [
                { width: 320, height: 568, name: 'Mobile Portrait' },
                { width: 768, height: 1024, name: 'Tablet Portrait' },
                { width: 1024, height: 768, name: 'Tablet Landscape' },
                { width: 1920, height: 1080, name: 'Desktop HD' }
            ];

            for (const size of sizes) {
                this.log(`📱 Симуляция ${size.name} (${size.width}x${size.height})`);

                // Триггерим события изменения размера
                window.dispatchEvent(new Event('resize'));
                document.documentElement.style.width = size.width + 'px';

                // Ждем применения медиа-запросов
                await this.delay(this.options.scrollDelay);

                // Проверяем появление новых элементов
                await this.checkForNewElements();
            }

            // Возвращаем исходный размер
            document.documentElement.style.width = '';
            window.dispatchEvent(new Event('resize'));
        }

        /**
         * Активация hover эффектов
         */
        async triggerHoverEffects() {
            if (!this.options.enableHover) return;

            const hoverElements = this.getAllElements(this.selectors.hoverable);
            this.log(`🖱️ Обработка ${hoverElements.length} hover элементов`);

            for (const element of hoverElements) {
                if (!this.isElementInteractable(element)) continue;

                try {
                    // Наводим курсор
                    this.dispatchMouseEvent(element, 'mouseenter');
                    this.dispatchMouseEvent(element, 'mouseover');

                    await this.delay(this.options.mouseDelay);

                    // Убираем курсор
                    this.dispatchMouseEvent(element, 'mouseleave');
                    this.dispatchMouseEvent(element, 'mouseout');

                    this.state.processedElements.add(element);

                } catch (error) {
                    this.handleError(`Ошибка hover для элемента`, error, element);
                }
            }
        }

        /**
         * Взаимодействие с кликабельными элементами
         */
        async interactWithClickables() {
            if (!this.options.enableClick) return;

            const elements = this.getAllElements(this.selectors.interactive);
            this.log(`👆 Безопасная обработка ${elements.length} кликабельных элементов`);

            // Сортируем по приоритету безопасности
            elements.sort((a, b) => {
                const priorityA = this.getClickPriority(a);
                const priorityB = this.getClickPriority(b);
                return priorityB - priorityA;
            });

            for (const element of elements) {
                if (!this.isElementInteractable(element)) continue;

                try {
                    const beforeHTML = document.body.innerHTML.length;

                    // Используем безопасный клик
                    const clicked = this.safeClick(element);

                    if (clicked) {
                        await this.delay(this.options.clickDelay);

                        // Проверяем изменения DOM
                        const afterHTML = document.body.innerHTML.length;
                        const domChanged = Math.abs(afterHTML - beforeHTML) > 100;

                        if (domChanged) {
                            this.log("📄 Обнаружены изменения DOM после безопасного клика", "info");
                            await this.checkForNewElements();
                        }

                        this.state.processedElements.add(element);
                    }

                } catch (error) {
                    this.handleError("Ошибка безопасного клика по элементу", error, element);
                }
            }
        }

        /**
         * Работа с формами
         */
        async interactWithForms() {
            if (!this.options.enableFocus) return;

            const formElements = this.getAllElements(this.selectors.forms);
            this.log(`📝 Обработка ${formElements.length} элементов форм`);

            for (const element of formElements) {
                if (!this.isElementInteractable(element)) continue;

                try {
                    await this.interactWithFormElement(element);
                    this.state.processedElements.add(element);
                } catch (error) {
                    this.handleError(`Ошибка взаимодействия с формой`, error, element);
                }
            }
        }

        /**
         * Взаимодействие с конкретным элементом формы
         */
        async interactWithFormElement(element) {
            const tagName = element.tagName.toLowerCase();
            const type = element.type?.toLowerCase();

            // Фокус
            element.focus();
            await this.delay(this.options.inputDelay);

            switch (tagName) {
                case 'input':
                    await this.handleInputElement(element, type);
                    break;
                case 'textarea':
                    element.value = 'Test content';
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                    break;
                case 'select':
                    // Уже обработано в performClick
                    break;
            }

            // Потеря фокуса
            element.blur();
            await this.delay(this.options.inputDelay);
        }

        /**
         * Обработка input элементов
         */
        async handleInputElement(element, type) {
            const testValues = {
                'text': 'Test text',
                'email': 'test@example.com',
                'password': 'password123',
                'number': '123',
                'tel': '+1234567890',
                'url': 'https://example.com',
                'search': 'search query',
                'date': '2024-01-01',
                'time': '12:00',
                'color': '#ff0000'
            };

            if (testValues[type]) {
                element.value = testValues[type];
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (type === 'checkbox' || type === 'radio') {
                // Уже обработано в performClick
            } else if (type === 'range') {
                const min = parseInt(element.min) || 0;
                const max = parseInt(element.max) || 100;
                element.value = Math.floor((min + max) / 2);
                element.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }

        /**
         * Прокрутка страницы и активация ленивой загрузки
         */
        async performScrolling() {
            if (!this.options.enableScroll) return;

            this.log('📜 Выполнение прокрутки страницы');

            const scrollPositions = [
                0,
                window.innerHeight,
                window.innerHeight * 2,
                window.innerHeight * 3,
                document.body.scrollHeight
            ];

            for (const position of scrollPositions) {
                window.scrollTo({ top: position, behavior: 'smooth' });
                await this.delay(this.options.scrollDelay);

                // Проверяем появление новых элементов после прокрутки
                await this.checkForNewElements();
            }

            // Горизонтальная прокрутка, если есть
            if (document.body.scrollWidth > window.innerWidth) {
                const horizontalPositions = [0, window.innerWidth, document.body.scrollWidth];
                for (const position of horizontalPositions) {
                    window.scrollTo({ left: position, behavior: 'smooth' });
                    await this.delay(this.options.scrollDelay);
                }
            }

            // Возвращаемся наверх
            window.scrollTo({ top: 0, behavior: 'smooth' });
            await this.delay(this.options.scrollDelay);
        }

        /**
         * Симуляция клавиатурной навигации
         */
        async simulateKeyboardNavigation() {
            if (!this.options.enableKeyboard) return;

            this.log('⌨️ Симуляция клавиатурной навигации');

            const keys = [
                'Tab', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown',
                'ArrowLeft', 'ArrowRight', 'Space'
            ];

            // Находим первый фокусируемый элемент
            const focusable = document.querySelector(
                'input, button, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'
            );

            if (focusable) {
                focusable.focus();

                for (const key of keys) {
                    try {
                        document.dispatchEvent(new KeyboardEvent('keydown', {
                            key: key,
                            code: key,
                            bubbles: true
                        }));

                        await this.delay(this.options.inputDelay);

                        document.dispatchEvent(new KeyboardEvent('keyup', {
                            key: key,
                            code: key,
                            bubbles: true
                        }));

                    } catch (error) {
                        this.handleError(`Ошибка клавиатурного события ${key}`, error);
                    }
                }
            }
        }

        /**
         * Активация медиа элементов
         */
        async activateMediaElements() {
            const mediaElements = this.getAllElements(this.selectors.media);
            this.log(`🎬 Обработка ${mediaElements.length} медиа элементов`);

            for (const element of mediaElements) {
                try {
                    const tagName = element.tagName.toLowerCase();

                    if (tagName === 'video' || tagName === 'audio') {
                        // Попытка воспроизведения
                        if (element.play && typeof element.play === 'function') {
                            const playPromise = element.play();
                            if (playPromise) {
                                playPromise.catch(() => { }); // Игнорируем ошибки автовоспроизведения
                            }

                            await this.delay(this.options.inputDelay);

                            if (element.pause && typeof element.pause === 'function') {
                                element.pause();
                            }
                        }
                    } else if (tagName === 'iframe') {
                        // Для iframe просто отмечаем как обработанный
                        this.state.processedElements.add(element);
                    }

                } catch (error) {
                    this.handleError(`Ошибка активации медиа элемента`, error, element);
                }
            }
        }

        /**
         * Поиск и активация скрытых элементов
         */
        async revealHiddenElements() {
            this.log('🔍 Поиск скрытых элементов');

            // Элементы с display: none или visibility: hidden
            const hiddenElements = Array.from(document.querySelectorAll('*')).filter(el => {
                const style = window.getComputedStyle(el);
                return style.display === 'none' || style.visibility === 'hidden';
            });

            for (const element of hiddenElements.slice(0, 50)) { // Ограничиваем количество
                try {
                    // Временно показываем элемент
                    const originalDisplay = element.style.display;
                    const originalVisibility = element.style.visibility;

                    element.style.display = 'block';
                    element.style.visibility = 'visible';

                    await this.delay(this.options.mouseDelay);

                    // Возвращаем исходное состояние
                    element.style.display = originalDisplay;
                    element.style.visibility = originalVisibility;

                    this.state.discoveredElements.add(element);

                } catch (error) {
                    this.handleError(`Ошибка показа скрытого элемента`, error, element);
                }
            }
        }

        /**
         * Триггер кастомных событий
         */
        async triggerCustomEvents() {
            if (!this.options.triggerCustomEvents) return;

            this.log('⚡ Триггер кастомных событий');

            const customEvents = [
                'load', 'DOMContentLoaded', 'scroll', 'resize', 'orientationchange',
                'focus', 'blur', 'mouseenter', 'mouseleave', 'touchstart', 'touchend'
            ];

            for (const eventName of customEvents) {
                try {
                    const event = new Event(eventName, { bubbles: true, cancelable: true });
                    document.dispatchEvent(event);
                    window.dispatchEvent(event);

                    await this.delay(this.options.mouseDelay);

                } catch (error) {
                    this.handleError(`Ошибка кастомного события ${eventName}`, error);
                }
            }
        }

        /**
         * Финальная проверка и подсчет результатов
         */
        async finalCheck() {
            this.log('🏁 Финальная проверка');

            // Последняя проверка на новые элементы
            await this.checkForNewElements();

            // Подсчет статистики
            const finalElementsCount = document.querySelectorAll('*').length;
            const discoveredCount = finalElementsCount - this.state.initialElementsCount;

            if (discoveredCount > 0) {
                this.log(`📊 Обнаружено ${discoveredCount} новых элементов в DOM`, 'success');
            }

            this.log(`📈 Обработано элементов: ${this.state.processedElements.size}`, 'info');
            this.log(`🔍 Обнаружено скрытых: ${this.state.discoveredElements.size}`, 'info');
        }

        /**
         * Утилиты и вспомогательные методы
         */

        getAllElements(selectors) {
            const elements = new Set();

            for (const selector of selectors) {
                try {
                    document.querySelectorAll(selector).forEach(el => elements.add(el));
                } catch (error) {
                    // Игнорируем ошибки селекторов
                }
            }

            return Array.from(elements);
        }

        isElementInteractable(element) {
            if (!element || !element.offsetParent) return false;

            const style = window.getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
            if (style.pointerEvents === 'none') return false;

            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        }

        isDestructiveElement(element) {
            if (!element) return true;

            const destructiveSelectors = [
                '[type="submit"]',
                'input[type="submit"]',
                'button[type="submit"]',
                '.delete', '.remove', '.destroy',
                '.logout', '.signout', '.exit',
                '.cancel', '.close', '.dismiss',
                'a[href*="delete"]', 'a[href*="remove"]',
                'a[href*="logout"]', 'a[href*="exit"]',
                'button[onclick*="delete"]',
                'button[onclick*="remove"]',
                '[data-action*="delete"]',
                '[data-action*="remove"]'
            ];

            // Проверяем по селекторам
            const matchesDestructive = destructiveSelectors.some(selector => {
                try {
                    return element.matches(selector);
                } catch {
                    return false;
                }
            });

            if (matchesDestructive) return true;

            // Проверяем текстовое содержимое
            const text = (element.textContent || element.value || '').toLowerCase();
            const destructiveWords = ['delete', 'remove', 'destroy', 'logout', 'sign out', 'exit', 'cancel', 'close'];

            return destructiveWords.some(word => text.includes(word));
        }

        stop() {
            this.state.isRunning = false;

            if (this.observer) {
                this.observer.disconnect();
            }

            // Разблокируем навигацию при остановке
            if (this.isNavigationBlocked) {
                this.unblockNavigation();
            }

            this.log("⏹️ Процесс остановлен пользователем");
        }

        getClickPriority(element) {
            const tagName = element.tagName.toLowerCase();
            const classList = Array.from(element.classList);

            // Приоритеты для разных типов элементов
            if (tagName === 'button') return 100;
            if (classList.includes('btn')) return 90;
            if (element.hasAttribute('onclick')) return 80;
            if (tagName === 'a') return 70;
            if (element.hasAttribute('tabindex')) return 60;

            return 50;
        }

        dispatchMouseEvent(element, eventType) {
            const event = new MouseEvent(eventType, {
                view: window,
                bubbles: true,
                cancelable: true
            });
            element.dispatchEvent(event);
        }

        async checkForNewElements() {
            // Даем время на рендеринг
            await this.delay(this.options.observerDelay);

            const currentCount = document.querySelectorAll('*').length;
            if (currentCount > this.state.initialElementsCount) {
                this.log(`📢 Обнаружены новые элементы DOM (+${currentCount - this.state.initialElementsCount})`, 'info');
            }
        }

        async setupObserver() {
            if (this.observer) {
                this.observer.disconnect();
            }

            this.observer = new MutationObserver((mutations) => {
                let hasChanges = false;

                mutations.forEach(mutation => {
                    if (mutation.type === 'childList' &&
                        (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                        hasChanges = true;
                    }
                });

                if (hasChanges) {
                    this.log('🔄 Обнаружены изменения DOM', 'debug');
                }
            });

            this.observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style', 'hidden']
            });
        }

        updateProgress(step, percent) {
            this.state.currentStep = step;
            this.state.progress = Math.round(percent);

            if (this.options.onProgress) {
                this.options.onProgress(this.state.progress, step);
            }

            this.log(`📊 ${step} (${this.state.progress}%)`);
        }

        handleError(message, error, element = null) {
            const errorInfo = {
                message,
                error: error.message,
                element: element ? this.getElementInfo(element) : null,
                timestamp: new Date().toISOString()
            };

            this.state.errors.push(errorInfo);
            this.log(`❌ ${message}: ${error.message}`, 'error');

            if (this.options.onError) {
                this.options.onError(errorInfo);
            }
        }

        getElementInfo(element) {
            return {
                tagName: element.tagName,
                id: element.id,
                className: element.className,
                textContent: element.textContent?.slice(0, 50)
            };
        }

        delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        log(message, type = 'info') {
            const prefix = {
                info: 'ℹ️',
                success: '✅',
                error: '❌',
                debug: '🐛'
            }[type] || 'ℹ️';

            console.log(`${prefix} [DynamicContentDetector] ${message}`);
        }

        getResults() {
            return {
                processedElements: this.state.processedElements.size,
                discoveredElements: this.state.discoveredElements.size,
                errors: this.state.errors,
                finalElementCount: document.querySelectorAll('*').length,
                newElementsFound: document.querySelectorAll('*').length - this.state.initialElementsCount
            };
        }

        /**
         * Остановка процесса
         */
        stop() {
            this.state.isRunning = false;
            if (this.observer) {
                this.observer.disconnect();
            }
            this.log('⏹️ Процесс остановлен пользователем');
        }
    }

    // Экспорт для использования
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DynamicContentDetector;
    } else {
        window.DynamicContentDetector = DynamicContentDetector;
    }

    const detector = new DynamicContentDetector({
        onProgress: (percent, step) => {
            console.log(`Прогресс: ${percent}% - ${step}`);
        },
        onComplete: (results) => {
            console.log('🎉 Обход завершен!', results);

            if (detector.observer && typeof detector.observer.disconnect === 'function') {
                detector.observer.disconnect();
                console.log('🛑 MutationObserver отключен');
            }

            if (detector.options.autoSave) {
                const selectorsByFile = SelectorManager.groupSelectorsByFile();
                if (Object.keys(selectorsByFile).length === 0) {
                    console.log('Нет найденных селекторов для сохранения');
                    return;
                }
                try {
                    UIManager.saveDataToServer(selectorsByFile);
                    console.log('✅ Правила сохранены автоматически');
                } catch (e) {
                    console.error('Ошибка автоматического сохранения:', e);
                }
            }

        },
        onError: (error) => {
            console.warn('⚠️ Ошибка:', error);
        }
    });

    startApp();
})();
