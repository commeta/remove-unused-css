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

        CRAWLER_DB_NAME: 'SiteCrawlerDB', // Имя базы данных для хранения информации о сканировании
        CRAWLER_DB_VERSION: 1, // Версия базы данных для IndexedDB
        CRAWLER_STORE_NAME: 'crawled_urls', // Имя хранилища для сохранения информации о сканированных URL
        CRAWLER_STATUS_KEY: 'crawler_status', // Ключ для хранения статуса сканирования в IndexedDB
        MAX_CRAWL_DEPTH: 5, // Максимальная глубина сканирования ссылок на сайте
        CRAWL_DELAY: 3000, // Задержка между запросами при сканировании сайта (в миллисекундах)
        MAX_URLS_PER_SESSION: 1000, // Максимальное количество URL для обработки за одну сессию сканирования

        TAB_HEARTBEAT_INTERVAL: 5000, // Интервал (в миллисекундах) для heartbeat-сообщений между вкладками
        URL_LEASE_TIMEOUT: 30000, // Таймаут (в миллисекундах) для блокировки URL (если вкладка не отвечает)
        MAX_RETRY_COUNT: 3, // Максимальное количество попыток повторной обработки URL при ошибках
        BATCH_SIZE: 5, // Размер батча для обработки URL (количество URL за один запрос)
        SYNC_CHANNEL: 'sitecrawler_sync', // Канал для синхронизации между вкладками
        TAB_STORE_NAME: 'active_tabs', // Имя хранилища для активных вкладок в IndexedDB
        LOCK_STORE_NAME: 'url_locks', // Имя хранилища для блокировок URL в IndexedDB

        PARSE_CSS_IMPORTS: true, // Включить парсинг @import директив
        MAX_IMPORT_DEPTH: 10    // Максимальная глубина вложенности импортов        
    };

    // Состояние приложения: хранит данные для анализа и настройки очистки CSS
    let state = {
        // Map для хранения неиспользованных селекторов: ключ — селектор, значение — детали использования
        unusedSelectors: new Map(),

        unusedKeyframes: new Map(),
        unusedFontFaces: new Map(),
        unusedCounterStyles: new Map(),

        // Map для информации о стилевых таблицах (CSS-файлах): ключ — URL или путь, значение — объект с метаданными
        styleSheetsInfo: new Map(),

        // Флаг, указывающий, идёт ли сейчас процесс анализа/генерации
        isProcessing: false,

        // Общее количество неиспользованных селекторов на всех страницах
        totalUnusedCount: 0,

        // Set селекторов, найденных на текущей странице
        currentPageSelectors: new Set(),

        importedFiles: new Map(), // Кэш загруженных импортов: URL -> content
        importProcessingStack: new Set(), // Защита от циклических импортов

        // Настройки фильтрации/сохранения разных видов правил и селекторов
        settings: {
            media: true,               // флаг сохранения @media
            media_print: true,         // флаг сохранения @media print
            keyframes: true,           // флаг сохранения анимаций @keyframes
            font_face: true,           // флаг сохранения @font-face
            supports: true,            // флаг сохранения @supports
            page: true,                // флаг сохранения @page
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
            logical_selectors: true,   // флаг сохранения логических селекторов (:not(), :is(), :has())

            used_css_list: '', // Белый список селекторов
            unused_css_list: '', // Черный список селекторов
            generation_mode: 'remove_unused' // 'remove_unused' или 'keep_used'            
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

        static parseImportUrls(cssText) {
            // Парсит CSS текст и извлекает все @import директивы
            const imports = [];
            const importRegex = /@import\s+(?:url\()?['"']?([^'"();\r\n]+)['"']?\)?(?:\s+([^;]+))?;/gi;
            let match;

            while ((match = importRegex.exec(cssText)) !== null) {
                const url = match[1].trim();
                const media = match[2] ? match[2].trim() : null;
                imports.push({ url, media });
            }

            return imports;
        }

        static resolveImportUrl(importUrl, baseHref) {
            // Резолвит относительный URL импорта относительно базового CSS файла
            try {
                if (!baseHref || baseHref === 'external') {
                    return new URL(importUrl, window.location.origin).href;
                }

                // Создаем базовый URL из href
                const baseUrl = new URL(baseHref, window.location.origin);
                // Резолвим импорт относительно базового URL
                const resolvedUrl = new URL(importUrl, baseUrl);

                return resolvedUrl.href;
            } catch (error) {
                console.warn(`Ошибка резолвинга URL импорта: ${importUrl} относительно ${baseHref}`, error);
                return null;
            }
        }

        static async loadImportedCSS(importUrl, baseHref, depth = 0) {
            // Рекурсивно загружает и обрабатывает импортированные CSS файлы
            if (!CONFIG.PARSE_CSS_IMPORTS || depth >= CONFIG.MAX_IMPORT_DEPTH) {
                return [];
            }

            const resolvedUrl = this.resolveImportUrl(importUrl, baseHref);
            if (!resolvedUrl) return [];

            // Защита от циклических импортов
            if (state.importProcessingStack.has(resolvedUrl)) {
                console.warn(`Обнаружен циклический импорт: ${resolvedUrl}`);
                return [];
            }

            // Проверяем кэш
            if (state.importedFiles.has(resolvedUrl)) {
                return state.importedFiles.get(resolvedUrl);
            }

            try {
                state.importProcessingStack.add(resolvedUrl);

                // Загружаем CSS файл
                const cssContent = await this.loadStyleSheetContent(resolvedUrl);
                if (!cssContent) {
                    return [];
                }

                const results = [];

                // Парсим основной контент
                const rules = this.parseCSSText(cssContent);
                if (rules) {
                    results.push({
                        url: resolvedUrl,
                        content: cssContent,
                        rules: rules,
                        media: null
                    });
                }

                // Ищем вложенные импорты
                const nestedImports = this.parseImportUrls(cssContent);
                for (const nestedImport of nestedImports) {
                    const nestedResults = await this.loadImportedCSS(
                        nestedImport.url,
                        resolvedUrl,
                        depth + 1
                    );

                    // Добавляем media контекст к вложенным импортам
                    nestedResults.forEach(result => {
                        if (nestedImport.media && !result.media) {
                            result.media = nestedImport.media;
                        } else if (nestedImport.media && result.media) {
                            result.media = `${nestedImport.media} and ${result.media}`;
                        }
                    });

                    results.push(...nestedResults);
                }

                // Кэшируем результат
                state.importedFiles.set(resolvedUrl, results);

                return results;

            } catch (error) {
                console.warn(`Ошибка загрузки импорта ${resolvedUrl}:`, error);
                return [];
            } finally {
                state.importProcessingStack.delete(resolvedUrl);
            }
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
                    let reallyUsed = false;

                    try {
                        const exists = document.querySelector(selector);
                        reallyUsed = !!exists;
                    } catch (error) {
                        reallyUsed = true; // Если ошибка селектора, считаем используемым
                    }

                    // Применяем логику белого и черного списков
                    if (this.isInBlackList(selector)) {
                        // Селектор в черном списке - принудительно неиспользуемый
                        info.used = false;
                    } else if (this.isInWhiteList(selector)) {
                        // Селектор в белом списке - принудительно используемый
                        info.used = true;
                    } else {
                        // Обычная логика проверки
                        info.used = reallyUsed;
                    }

                    if (!info.used && info.safe) {
                        unusedCount++;
                    }
                }
            }

            for (const [name, info] of state.unusedKeyframes.entries()) {
                if (!info.used) {
                    let reallyUsed = false;

                    if (this.isInBlackList(name)) {
                        info.used = false;
                    } else if (this.isInWhiteList(name)) {
                        info.used = true;
                    } else {
                        reallyUsed = this.checkKeyframeUsage(name);
                        info.used = reallyUsed;
                    }

                    if (!info.used) {
                        unusedCount++;
                    }
                }
            }

            for (const [fontFamily, info] of state.unusedFontFaces.entries()) {
                if (!info.used) {
                    let reallyUsed = false;

                    if (this.isInBlackList(fontFamily)) {
                        info.used = false;
                    } else if (this.isInWhiteList(fontFamily)) {
                        info.used = true;
                    } else {
                        reallyUsed = this.checkFontFaceUsage(fontFamily);
                        info.used = reallyUsed;
                    }

                    if (!info.used) {
                        unusedCount++;
                    }
                }
            }

            for (const [name, info] of state.unusedCounterStyles.entries()) {
                if (!info.used) {
                    let reallyUsed = false;

                    if (this.isInBlackList(name)) {
                        info.used = false;
                    } else if (this.isInWhiteList(name)) {
                        info.used = true;
                    } else {
                        reallyUsed = this.checkCounterStyleUsage(name);
                        info.used = reallyUsed;
                    }

                    if (!info.used) {
                        unusedCount++;
                    }
                }
            }

            state.totalUnusedCount = unusedCount;
            UIManager.updateButton(unusedCount);
        }

        // Проверка использования keyframe
        static checkKeyframeUsage(keyframeName) {
            try {
                // Проверяем все элементы на наличие animation-name
                const elements = document.querySelectorAll('*');
                for (const element of elements) {
                    const computedStyle = window.getComputedStyle(element);
                    const animationName = computedStyle.getPropertyValue('animation-name');

                    if (animationName && animationName !== 'none') {
                        const names = animationName.split(',').map(n => n.trim());
                        if (names.includes(keyframeName)) {
                            return true;
                        }
                    }
                }

                // Проверяем inline стили
                const inlineElements = document.querySelectorAll('[style*="animation"]');
                for (const element of inlineElements) {
                    const style = element.getAttribute('style');
                    if (style && style.includes(keyframeName)) {
                        return true;
                    }
                }

                return false;
            } catch (error) {
                console.warn('Ошибка проверки keyframe:', error);
                return true; // Считаем используемым при ошибке
            }
        }

        // Проверка использования font-face
        static checkFontFaceUsage(fontFamily) {
            try {
                // Проверяем все элементы на наличие font-family
                const elements = document.querySelectorAll('*');
                for (const element of elements) {
                    const computedStyle = window.getComputedStyle(element);
                    const fontFamilyValue = computedStyle.getPropertyValue('font-family');

                    if (fontFamilyValue) {
                        const fonts = fontFamilyValue.split(',').map(f => f.trim().replace(/['"]/g, ''));
                        if (fonts.includes(fontFamily)) {
                            return true;
                        }
                    }
                }

                // Проверяем inline стили
                const inlineElements = document.querySelectorAll('[style*="font-family"]');
                for (const element of inlineElements) {
                    const style = element.getAttribute('style');
                    if (style && style.includes(fontFamily)) {
                        return true;
                    }
                }

                return false;
            } catch (error) {
                console.warn('Ошибка проверки font-face:', error);
                return true; // Считаем используемым при ошибке
            }
        }

        // Проверка использования counter-style
        static checkCounterStyleUsage(counterStyleName) {
            try {
                // Проверяем все элементы на наличие list-style-type или counter-reset/counter-increment
                const elements = document.querySelectorAll('*');
                for (const element of elements) {
                    const computedStyle = window.getComputedStyle(element);

                    const listStyleType = computedStyle.getPropertyValue('list-style-type');
                    if (listStyleType === counterStyleName) {
                        return true;
                    }

                    const counterReset = computedStyle.getPropertyValue('counter-reset');
                    if (counterReset && counterReset.includes(counterStyleName)) {
                        return true;
                    }

                    const counterIncrement = computedStyle.getPropertyValue('counter-increment');
                    if (counterIncrement && counterIncrement.includes(counterStyleName)) {
                        return true;
                    }
                }

                return false;
            } catch (error) {
                console.warn('Ошибка проверки counter-style:', error);
                return true; // Считаем используемым при ошибке
            }
        }

        static groupSelectorsByFile() {
            const grouped = {};

            // Обычные селекторы
            for (const [selector, info] of state.unusedSelectors.entries()) {
                const href = info.href;
                if (!grouped[href]) grouped[href] = [];
                grouped[href].push({
                    selector,
                    media: info.media,
                    used: info.used
                });
            }

            // Keyframes
            for (const [keyframeName, info] of state.unusedKeyframes.entries()) {
                const href = info.href;
                if (!grouped[href]) grouped[href] = [];
                grouped[href].push({
                    keyframes: keyframeName,
                    used: info.used
                });
            }

            // Font-faces
            for (const [fontFamily, info] of state.unusedFontFaces.entries()) {
                const href = info.href;
                if (!grouped[href]) grouped[href] = [];
                grouped[href].push({
                    'font-face': fontFamily,
                    used: info.used
                });
            }

            // Counter-styles
            for (const [counterStyleName, info] of state.unusedCounterStyles.entries()) {
                const href = info.href;
                if (!grouped[href]) grouped[href] = [];
                grouped[href].push({
                    'counter-style': counterStyleName,
                    used: info.used
                });
            }

            return grouped;
        }


        //  keyframe для отслеживания
        static addKeyframe(name, href) {
            if (!name || !state.settings.keyframes) return;
            const relativePath = CSSUtils.getRelativePathFromHref(href);
            if (!state.currentPageSelectors.has(relativePath)) return;

            if (!state.unusedKeyframes.has(name)) {
                state.unusedKeyframes.set(name, {
                    href: relativePath,
                    used: false
                });
            }
        }

        //  font-face для отслеживания
        static addFontFace(fontFamily, href) {
            if (!fontFamily || !state.settings.font_face) return;
            const relativePath = CSSUtils.getRelativePathFromHref(href);
            if (!state.currentPageSelectors.has(relativePath)) return;

            if (!state.unusedFontFaces.has(fontFamily)) {
                state.unusedFontFaces.set(fontFamily, {
                    href: relativePath,
                    used: false
                });
            }
        }

        //  counter-style для отслеживания
        static addCounterStyle(name, href) {
            if (!name || !state.settings.counter_style) return;
            const relativePath = CSSUtils.getRelativePathFromHref(href);
            if (!state.currentPageSelectors.has(relativePath)) return;

            if (!state.unusedCounterStyles.has(name)) {
                state.unusedCounterStyles.set(name, {
                    href: relativePath,
                    used: false
                });
            }
        }

        static wildcardToRegex(pattern) {
            if (!pattern || typeof pattern !== 'string') {
                return null;
            }
            
            // Экранируем все специальные символы регулярных выражений, кроме * и ?
            let escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
            
            // Заменяем wildcard символы на соответствующие регулярные выражения
            escaped = escaped.replace(/\*/g, '.*');  // * -> .* (любые символы)
            escaped = escaped.replace(/\?/g, '.');   // ? -> .  (один любой символ)
            
            try {
                return new RegExp('^' + escaped + '$', 'i'); // i = case-insensitive
            } catch (error) {
                console.warn(`Некорректный wildcard паттерн: ${pattern}`, error);
                return null;
            }
        }

        static matchesWildcardPatterns(selector, patterns) {
            if (!selector || !patterns || patterns.length === 0) {
                return false;
            }
            
            return patterns.some(pattern => {
                // Если паттерн не содержит wildcard символов, делаем точное сравнение
                if (!pattern.includes('*') && !pattern.includes('?')) {
                    return selector === pattern;
                }
                
                // Конвертируем в regex и проверяем
                const regex = this.wildcardToRegex(pattern);
                return regex ? regex.test(selector) : false;
            });
        }  

        static normalizePattern(pattern) {
            if (typeof pattern !== 'string') return '';
            // Убираем пробелы по краям
            let p = pattern.trim();
            // Игнорируем пустые строки и комментарии (начинаются с #)
            if (!p || p.startsWith('#')) {
                return '';
            }
            // Сжимаем множественные пробелы внутри строки до одного
            p = p.replace(/\s+/g, ' ');
            return p;
        }

        static parseListFromString(listString) {
            if (!listString || typeof listString !== 'string') {
                return [];
            }
            return listString
                .split('\n')
                .map(line => this.normalizePattern(line))
                .filter(pat => pat.length > 0);
        }

        static isInWhiteList(selector) {
            const whiteList = this.parseListFromString(state.settings.used_css_list);
            if (whiteList.length === 0) {
                return false;
            }
            
            return this.matchesWildcardPatterns(selector, whiteList);
        }

        static isInBlackList(selector) {
            const blackList = this.parseListFromString(state.settings.unused_css_list);
            if (blackList.length === 0) {
                return false;
            }
            
            return this.matchesWildcardPatterns(selector, blackList);
        }

    }

    // Processing CSS rules and stylesheets
    class RuleProcessor {
        static async processStyleSheet(sheet) {
            let rules;
            let cssContent = null;

            try {
                rules = sheet.cssRules;
            } catch (error) {
                if (error.name === 'SecurityError') {
                    const result = await this.handleCrossOriginStyleSheet(sheet);
                    rules = result?.rules || null;
                    cssContent = result?.content || null;
                } else {
                    console.warn(`Не удалось получить правила:`, error);
                    return;
                }
            }

            if (!rules) return;

            const baseHref = sheet.href || 'external';

            // Обрабатываем основные правила
            for (const rule of rules) {
                await this.processRule(rule, baseHref);
            }

            // Обрабатываем импорты, если включена соответствующая опция
            if (CONFIG.PARSE_CSS_IMPORTS && cssContent) {
                await this.processImports(cssContent, baseHref);
            } else if (CONFIG.PARSE_CSS_IMPORTS && !cssContent) {
                // Если у нас есть доступ к cssRules, но нет текста, пытаемся загрузить
                try {
                    const loadedContent = await CSSUtils.loadStyleSheetContent(baseHref);
                    if (loadedContent) {
                        await this.processImports(loadedContent, baseHref);
                    }
                } catch (error) {
                    console.warn(`Не удалось загрузить контент для обработки импортов: ${baseHref}`, error);
                }
            }
        }

        static async handleCrossOriginStyleSheet(sheet) {
            if (!sheet.href || !CSSUtils.isLocalUrl(sheet.href)) {
                console.warn(`Файл недоступен: ${sheet.href}`);
                return null;
            }

            const cssText = await CSSUtils.loadStyleSheetContent(sheet.href);
            if (!cssText) return null;

            const rules = CSSUtils.parseCSSText(cssText);
            return {
                rules: rules,
                content: cssText
            };
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
                    // Обработка keyframes
                    if (rule.name && state.settings.keyframes) {
                        SelectorManager.addKeyframe(rule.name, href);
                    }
                    break;
                case CSSRule.FONT_FACE_RULE:
                    // Обработка font-face
                    if (state.settings.font_face) {
                        const fontFamily = this.extractFontFamily(rule);
                        if (fontFamily) {
                            SelectorManager.addFontFace(fontFamily, href);
                        }
                    }
                    break;
                case 11: // CSSRule.COUNTER_STYLE_RULE (не все браузеры поддерживают константу)
                    // Обработка counter-style
                    if (rule.name && state.settings.counter_style) {
                        SelectorManager.addCounterStyle(rule.name, href);
                    }
                    break;
                case CSSRule.PAGE_RULE:
                case CSSRule.NAMESPACE_RULE:
                    break;
            }
        }

        static extractFontFamily(fontFaceRule) {
            try {
                const style = fontFaceRule.style;
                const fontFamily = style.getPropertyValue('font-family');

                if (fontFamily) {
                    // Убираем кавычки и лишние пробелы
                    return fontFamily.replace(/['"]/g, '').trim();
                }

                return null;
            } catch (error) {
                console.warn('Ошибка извлечения font-family:', error);
                return null;
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

        static async processImports(cssContent, baseHref) {
            // Обрабатывает все @import директивы в CSS контенте
            const imports = CSSUtils.parseImportUrls(cssContent);

            for (const importInfo of imports) {
                try {
                    const importResults = await CSSUtils.loadImportedCSS(importInfo.url, baseHref);

                    for (const result of importResults) {
                        const importHref = result.url;
                        const relativePath = CSSUtils.getRelativePathFromHref(importHref);

                        // Добавляем файл в список текущих селекторов страницы
                        state.currentPageSelectors.add(relativePath);

                        // Обрабатываем правила из импортированного файла
                        if (result.rules) {
                            for (const rule of result.rules) {
                                const mediaContext = result.media || importInfo.media;
                                await this.processImportedRule(rule, importHref, mediaContext);
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Ошибка обработки импорта ${importInfo.url}:`, error);
                }
            }
        }

        static async processImportedRule(rule, href, mediaContext = null) {
            // Обрабатывает правило из импортированного CSS файла
            switch (rule.type) {
                case CSSRule.STYLE_RULE:
                    SelectorManager.addSelector(rule.selectorText, href, mediaContext);
                    break;

                case CSSRule.MEDIA_RULE:
                    // Комбинируем media контексты
                    const combinedMedia = mediaContext
                        ? `${mediaContext} and ${rule.media.mediaText}`
                        : rule.media.mediaText;

                    for (const subRule of rule.cssRules) {
                        if (subRule.type === CSSRule.STYLE_RULE) {
                            SelectorManager.addSelector(subRule.selectorText, href, combinedMedia);
                        } else if (subRule.type === CSSRule.MEDIA_RULE) {
                            await this.processImportedRule(subRule, href, combinedMedia);
                        }
                    }
                    break;

                case CSSRule.KEYFRAMES_RULE:
                    if (rule.name && state.settings.keyframes) {
                        SelectorManager.addKeyframe(rule.name, href);
                    }
                    break;

                case CSSRule.FONT_FACE_RULE:
                    if (state.settings.font_face) {
                        const fontFamily = this.extractFontFamily(rule);
                        if (fontFamily) {
                            SelectorManager.addFontFace(fontFamily, href);
                        }
                    }
                    break;

                case 11: // CSSRule.COUNTER_STYLE_RULE
                    if (rule.name && state.settings.counter_style) {
                        SelectorManager.addCounterStyle(rule.name, href);
                    }
                    break;

                case CSSRule.SUPPORTS_RULE:
                    for (const subRule of rule.cssRules) {
                        await this.processImportedRule(subRule, href, mediaContext);
                    }
                    break;
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
            overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;' +
                'background:rgba(0,0,0,0.5);z-index:10001;display:flex;' +
                'align-items:center;justify-content:center;';

            const modal = document.createElement('div');
            modal.style.cssText = 'background:white;border-radius:8px;padding:20px;' +
                'max-width:700px;width:90%;max-height:80%;overflow-y:auto;color:#333;';

            const title = document.createElement('h3');
            title.textContent = 'Настройки защиты селекторов';
            title.style.cssText = 'margin:0 0 15px 0;color:#333;font-size:18px;';

            // список настроек
            const settingsList = [
                { key: 'media', label: '@media запросы' },
                { key: 'media_print', label: '@media print запросы' },
                { key: 'keyframes', label: '@keyframes анимации' },
                { key: 'font_face', label: '@font-face шрифты' },
                { key: 'supports', label: '@supports поддержка' },
                { key: 'page', label: '@page печать' },
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

            // Добавляем чекбоксы настроек
            settingsList.forEach(setting => {
                const item = document.createElement('div');
                item.style.cssText = 'margin-bottom:10px;display:flex;align-items:center;';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.id = setting.key;
                checkbox.checked = state.settings[setting.key];
                checkbox.style.cssText = 'margin-right:10px;';

                const label = document.createElement('label');
                label.htmlFor = setting.key;
                label.textContent = setting.label;
                label.style.cssText = 'cursor:pointer;flex:1;';

                item.appendChild(checkbox);
                item.appendChild(label);
                modal.appendChild(item);
            });

            // Добавляем разделитель
            const separator1 = document.createElement('hr');
            separator1.style.cssText = 'margin:20px 0;border:1px solid #ddd;';
            modal.appendChild(separator1);

            // Добавляем textarea для белого списка
            const whiteListLabel = document.createElement('label');
            whiteListLabel.textContent = 'Белый список селекторов (через запятую):';
            whiteListLabel.style.cssText = 'display:block;margin-bottom:5px;font-weight:bold;';
            modal.appendChild(whiteListLabel);

            const whiteListTextarea = document.createElement('textarea');
            whiteListTextarea.id = 'used_css_list';
            whiteListTextarea.value = state.settings.used_css_list || '';
            whiteListTextarea.placeholder = 'Каждый паттерн с новой строки:\n.button\n#header\n.*-item\n*-component\nmy-class-?';
            whiteListTextarea.style.cssText = 'width:100%;height:60px;margin-bottom:15px;' +
                'padding:8px;border:1px solid #ddd;border-radius:4px;' +
                'font-family:monospace;font-size:12px;resize:vertical;';
            modal.appendChild(whiteListTextarea);

            // Добавляем textarea для черного списка  
            const blackListLabel = document.createElement('label');
            blackListLabel.textContent = 'Черный список селекторов (через запятую):';
            blackListLabel.style.cssText = 'display:block;margin-bottom:5px;font-weight:bold;';
            modal.appendChild(blackListLabel);

            const blackListTextarea = document.createElement('textarea');
            blackListTextarea.id = 'unused_css_list';
            blackListTextarea.value = state.settings.unused_css_list || '';
            blackListTextarea.placeholder = 'Каждый паттерн с новой строки:\n.old-class\n#deprecated\n.*-btn\ntest-*\ndebug-?-class';
            blackListTextarea.style.cssText = 'width:100%;height:60px;margin-bottom:15px;' +
                'padding:8px;border:1px solid #ddd;border-radius:4px;' +
                'font-family:monospace;font-size:12px;resize:vertical;';
            modal.appendChild(blackListTextarea);

            // Добавляем разделитель
            const separator2 = document.createElement('hr');
            separator2.style.cssText = 'margin:20px 0;border:1px solid #ddd;';
            modal.appendChild(separator2);

            // Добавляем радио-кнопки для режима генерации
            const generationModeLabel = document.createElement('label');
            generationModeLabel.textContent = 'Режим генерации файлов:';
            generationModeLabel.style.cssText = 'display:block;margin-bottom:10px;font-weight:bold;';
            modal.appendChild(generationModeLabel);

            const radioContainer = document.createElement('div');
            radioContainer.style.cssText = 'margin-bottom:15px;';

            // Первая радио-кнопка
            const radio1Container = document.createElement('div');
            radio1Container.style.cssText = 'margin-bottom:8px;display:flex;align-items:center;';

            const radio1 = document.createElement('input');
            radio1.type = 'radio';
            radio1.name = 'generation_mode';
            radio1.id = 'mode_remove_unused';
            radio1.value = 'remove_unused';
            radio1.checked = (state.settings.generation_mode || 'remove_unused') === 'remove_unused';
            radio1.style.cssText = 'margin-right:8px;';

            const radio1Label = document.createElement('label');
            radio1Label.htmlFor = 'mode_remove_unused';
            radio1Label.textContent = 'При генерации убираем все неиспользуемые';
            radio1Label.style.cssText = 'cursor:pointer;';

            radio1Container.appendChild(radio1);
            radio1Container.appendChild(radio1Label);

            // Вторая радио-кнопка
            const radio2Container = document.createElement('div');
            radio2Container.style.cssText = 'margin-bottom:8px;display:flex;align-items:center;';

            const radio2 = document.createElement('input');
            radio2.type = 'radio';
            radio2.name = 'generation_mode';
            radio2.id = 'mode_keep_used';
            radio2.value = 'keep_used';
            radio2.checked = (state.settings.generation_mode || 'remove_unused') === 'keep_used';
            radio2.style.cssText = 'margin-right:8px;';

            const radio2Label = document.createElement('label');
            radio2Label.htmlFor = 'mode_keep_used';
            radio2Label.textContent = 'При генерации убираем всё кроме используемых';
            radio2Label.style.cssText = 'cursor:pointer;';

            radio2Container.appendChild(radio2);
            radio2Container.appendChild(radio2Label);

            radioContainer.appendChild(radio1Container);
            radioContainer.appendChild(radio2Container);
            modal.appendChild(radioContainer);

            // Кнопки управления
            const buttons = document.createElement('div');
            buttons.style.cssText = 'margin-top:20px;display:flex;gap:10px;justify-content:flex-end;';

            const saveBtn = document.createElement('button');
            saveBtn.textContent = 'Сохранить';
            saveBtn.style.cssText = 'padding:8px 16px;background:#27ae60;color:white;' +
                'border:none;border-radius:4px;cursor:pointer;';

            saveBtn.onclick = async () => {
                const newSettings = {};

                // Собираем настройки чекбоксов
                settingsList.forEach(setting => {
                    const checkbox = document.getElementById(setting.key);
                    newSettings[setting.key] = checkbox.checked;
                });

                // Собираем текстовые списки
                newSettings.used_css_list = whiteListTextarea.value.trim();
                newSettings.unused_css_list = blackListTextarea.value.trim();

                // Собираем режим генерации
                const checkedRadio = document.querySelector('input[name="generation_mode"]:checked');
                newSettings.generation_mode = checkedRadio ? checkedRadio.value : 'remove_unused';

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
            cancelBtn.style.cssText = 'padding:8px 16px;background:#95a5a6;color:white;' +
                'border:none;border-radius:4px;cursor:pointer;';
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

            // 1) Контейнер по центру правого края
            const container = document.createElement('div');
            container.style.cssText = `
                position: fixed;
                top: 50%;
                right: 0;
                transform: translateY(-50%);
                z-index: 9999;
                display: flex;
                align-items: center;
            `;

            // 2) Сам «button» как панелька
            const button = document.createElement('button');
            button.id = CONFIG.BUTTON_ID;
            button.innerHTML = 'Меню';
            button.title = 'Открыть меню';
            button.style.cssText = `
                padding: 0 16px;
                height: 40px;
                background-color: #e74c3c;
                color: white;
                border: none;
                border-radius: 8px 0 0 8px;
                font-size: 14px;
                font-weight: bold;
                cursor: pointer;
                box-shadow: 0 4px 8px rgba(0,0,0,0.3);
                transition: all 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: center;
            `;

            // 3) Выезжающее меню — появляется слева от кнопки
            const menu = document.createElement('div');
            menu.id = CONFIG.MENU_ID;
            menu.style.cssText = `
                position: absolute;
                right: 100%;
                top: 50%;
                background: white;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                min-width: 200px;
                opacity: 0;
                transform: translateX(10px) translateY(-50%);
                transition: all 0.3s ease;
                pointer-events: none;
                border: 1px solid #ddd;
                overflow: hidden;
            `;

            // пункты меню
            const menuItems = [
                { text: 'Сохранить данные', action: 'save', icon: '💾' },
                { text: 'Генерировать файлы', action: 'generate', icon: '🛠️' },
                { text: 'Показать отчёт', action: 'report', icon: '📊' },
                { text: 'Настройки', action: 'settings', icon: '⚙️' },
                { text: 'Детектор', action: 'detector', icon: '🔍' },
                { text: 'Краулер', action: 'crawler', icon: '🕷️' },
                { text: 'Сброс данных', action: 'reset', icon: '🔄' }
            ];

            menuItems.forEach((item, index) => {
                const menuItem = document.createElement('div');
                menuItem.style.cssText = `
                    padding: 12px 16px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 14px;
                    color: #333;
                    border-bottom: ${index < menuItems.length - 1 ? '1px solid #eee' : 'none'};
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

            // hover‑эффекты для кнопки
            button.addEventListener('mouseenter', () => {
                button.style.transform = 'scale(1.05)';
                button.style.backgroundColor = '#c0392b';
            });
            button.addEventListener('mouseleave', () => {
                button.style.transform = 'scale(1)';
                button.style.backgroundColor = '#e74c3c';
            });

            // переключение видимости меню
            button.addEventListener('click', e => {
                e.stopPropagation();
                this.toggleMenu();
            });

            // сборка DOM
            container.appendChild(menu);
            container.appendChild(button);
            document.body.appendChild(container);

            // клик вне меню — скрываем
            document.addEventListener('click', () => this.hideMenu());
            menu.addEventListener('click', e => e.stopPropagation());
        }

        static toggleMenu() {
            const menu = document.getElementById(CONFIG.MENU_ID);
            if (!menu) return;
            const visible = menu.style.opacity === '1';
            visible ? this.hideMenu() : this.showMenu();
        }

        static showMenu() {
            const menu = document.getElementById(CONFIG.MENU_ID);
            if (!menu) return;
            menu.style.opacity = '1';
            menu.style.transform = 'translateX(0) translateY(-50%)';
            menu.style.pointerEvents = 'auto';
        }

        static hideMenu() {
            const menu = document.getElementById(CONFIG.MENU_ID);
            if (!menu) return;
            menu.style.opacity = '0';
            menu.style.transform = 'translateX(10px) translateY(-50%)';
            menu.style.pointerEvents = 'none';
        }

        static async handleMenuClick(action) {
            if (state.isProcessing) return;

            if (action === 'reset') {
                if (confirm('Вы уверены, что хотите сбросить все данные? Это действие нельзя отменить!')) {
                    state.unusedSelectors.clear();
                    state.unusedKeyframes.clear();
                    state.unusedFontFaces.clear();
                    state.unusedCounterStyles.clear();
                    state.styleSheetsInfo.clear();
                    state.totalUnusedCount = 0;
                    state.currentPageSelectors.clear();
                    state.importedFiles.clear();
                    state.importProcessingStack.clear();

                    if (typeof crawler === 'undefined') {
                        return;
                    }

                    if (crawler.isRunning) {
                        await crawler.stop();
                    }

                    await crawler.reset();

                    //if (typeof detector !== 'undefined' && detector.state.isRunning) {
                    //await detector.stop();
                    //}

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
            let reportHtml = '<div style="'
                + 'position:relative;'
                + 'font-family:monospace;font-size:12px;line-height:1.4;'
                + 'width:calc(100vw - 20px);max-width:400px;'
                + 'margin:10px auto;'
                + 'box-sizing:border-box;'
                + 'padding:20px 30px 10px;'
                + 'background:#222;border-radius:6px;'
                + 'color:#fff;'
                + 'overflow-y:auto;max-height:calc(100vh - 80px);'
                + '">';

            reportHtml += '<h3 style="margin:0 0 8px;font-size:18px;color:#f1c40f;">'
                + '🔍 Отчет о неиспользуемых селекторах'
                + '</h3>';

            reportHtml += '<div style="margin-bottom:10px;padding:8px;'
                + 'background:#f8f9fa;border-radius:4px;'
                + 'color:#000;font-size:12px;">'
                + '<strong>⚠️ Внимание:</strong> Показаны селекторы на основе текущих настроек фильтрации.'
                + '</div>';

            for (const [file, selectors] of Object.entries(data)) {
                if (selectors.length === 0) continue;
                totalSelectors += selectors.length;

                const fileType = state.importedFiles.has(file) ? '📥 (импорт)' : '📄';
                reportHtml += '<div style="margin-bottom:10px;'
                    + 'border:1px solid #444;border-radius:4px;'
                    + 'padding:8px;word-break:break-word;'
                    + 'background:#333;">'
                    + '<strong style="display:block;color:#8ab4f8;'
                    + 'margin-bottom:4px;">'
                    + fileType + ' ' + file + ' (' + selectors.length + ' селекторов)'
                    + '</strong>';

                let list = selectors.slice(0, 10).map(s => s.selector).join(', ');
                if (selectors.length > 10) {
                    list += ' ... и еще ' + (selectors.length - 10);
                }
                reportHtml += '<small style="display:block;color:#ccc;'
                    + 'font-size:12px;">'
                    + list
                    + '</small>'
                    + '</div>';
            }

            reportHtml += '<div style="margin-top:10px;padding:8px;'
                + 'background:#e8f5e8;border-radius:4px;'
                + 'border:1px solid #4caf50;color:#000;'
                + 'font-size:12px;">'
                + '<strong>📊 Итого: ' + totalSelectors
                + ' селекторов в ' + Object.keys(data).length + ' файлах</strong>'
                + '</div>';

            reportHtml += '</div>';

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

                state.importedFiles.clear();
                state.importProcessingStack.clear();

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


    class TabSyncManager {
        constructor(crawler) {
            this.crawler = crawler;
            this.tabId = 'tab_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            this.heartbeatInterval = null;
            this.syncChannel = null;
            this.isActive = false;
            this.processedBatch = new Set();
        }

        async init() {
            try {
                this.syncChannel = new BroadcastChannel(CONFIG.SYNC_CHANNEL);
                this.syncChannel.onmessage = (e) => this.handleSyncMessage(e);
                await this.registerTab();
                this.startHeartbeat();
                this.isActive = true;
                this.crawler.log(`🔄 TabSync инициализирован: ${this.tabId}`, 'info');
                return true;
            } catch (error) {
                this.crawler.log(`❌ Ошибка инициализации TabSync: ${error.message}`, 'error');
                return false;
            }
        }

        async registerTab() {
            if (!this.crawler.db) return;
            const transaction = this.crawler.db.transaction([CONFIG.TAB_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.TAB_STORE_NAME);
            const tabData = {
                id: this.tabId,
                url: window.location.href,
                lastHeartbeat: Date.now(),
                status: 'active',
                processedCount: 0
            };
            store.put(tabData);
        }

        startHeartbeat() {
            this.heartbeatInterval = setInterval(async () => {
                if (!this.isActive) return;
                try {
                    await this.updateHeartbeat();
                    await this.cleanupDeadTabs();
                    await this.redistributeStuckUrls();
                } catch (error) {
                    this.crawler.log(`❌ Ошибка heartbeat: ${error.message}`, 'error');
                }
            }, CONFIG.TAB_HEARTBEAT_INTERVAL);
        }

        async updateHeartbeat() {
            if (!this.crawler.db) return;
            const transaction = this.crawler.db.transaction([CONFIG.TAB_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.TAB_STORE_NAME);
            const tabData = {
                id: this.tabId,
                url: window.location.href,
                lastHeartbeat: Date.now(),
                status: 'active',
                processedCount: this.processedBatch.size
            };
            store.put(tabData);
        }

        async cleanupDeadTabs() {
            if (!this.crawler.db) return;
            const now = Date.now();
            const transaction = this.crawler.db.transaction([CONFIG.TAB_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.TAB_STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                const tabs = request.result;
                tabs.forEach(tab => {
                    if (now - tab.lastHeartbeat > CONFIG.TAB_HEARTBEAT_INTERVAL * 3) {
                        store.delete(tab.id);
                        this.broadcastSync('tab_cleanup', { tabId: tab.id });
                    }
                });
            };
        }

        async redistributeStuckUrls() {
            if (!this.crawler.db) return;
            const now = Date.now();
            const transaction = this.crawler.db.transaction([CONFIG.CRAWLER_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.CRAWLER_STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                const urls = request.result;
                urls.forEach(urlData => {
                    if (urlData.status === 'processing' && urlData.lockedAt && now - urlData.lockedAt > CONFIG.URL_LEASE_TIMEOUT) {
                        urlData.status = 'pending';
                        urlData.lockedBy = null;
                        urlData.lockedAt = null;
                        urlData.retryCount = (urlData.retryCount || 0) + 1;
                        if (urlData.retryCount > CONFIG.MAX_RETRY_COUNT) {
                            urlData.status = 'failed_max_retries';
                        } else {
                            store.put(urlData);
                            this.broadcastSync('url_redistributed', { url: urlData.url });
                        }
                    }
                });
            };
        }

        async acquireUrlLock(url) {
            if (!this.crawler.db) return false;
            const transaction = this.crawler.db.transaction([CONFIG.CRAWLER_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.CRAWLER_STORE_NAME);
            return new Promise((resolve) => {
                const request = store.get(url);
                request.onsuccess = () => {
                    const urlData = request.result;
                    if (!urlData || urlData.status !== 'pending') {
                        resolve(false);
                        return;
                    }
                    urlData.status = 'processing';
                    urlData.lockedBy = this.tabId;
                    urlData.lockedAt = Date.now();
                    store.put(urlData);
                    resolve(true);
                };
                request.onerror = () => resolve(false);
            });
        }

        async releaseUrlLock(url, status = 'completed') {
            if (!this.crawler.db) return;
            const transaction = this.crawler.db.transaction([CONFIG.CRAWLER_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CONFIG.CRAWLER_STORE_NAME);
            const request = store.get(url);
            request.onsuccess = () => {
                const urlData = request.result;
                if (urlData && urlData.lockedBy === this.tabId) {
                    urlData.status = status;
                    urlData.lockedBy = null;
                    urlData.lockedAt = null;
                    urlData.completedAt = Date.now();
                    store.put(urlData);
                    this.broadcastSync('url_completed', { url, status });
                }
            };
        }

        async getNextBatch() {
            if (!this.crawler.db) return [];
            const transaction = this.crawler.db.transaction([CONFIG.CRAWLER_STORE_NAME], 'readonly');
            const store = transaction.objectStore(CONFIG.CRAWLER_STORE_NAME);
            return new Promise((resolve) => {
                const request = store.getAll();
                request.onsuccess = () => {
                    const allUrls = request.result;
                    const pendingUrls = allUrls.filter(u => u.status === 'pending').slice(0, CONFIG.BATCH_SIZE);
                    resolve(pendingUrls);
                };
                request.onerror = () => resolve([]);
            });
        }

        broadcastSync(type, data) {
            if (this.syncChannel) {
                this.syncChannel.postMessage({ type, data, from: this.tabId, timestamp: Date.now() });
            }
        }

        handleSyncMessage(event) {
            const { type, data, from } = event.data;
            if (from === this.tabId) return;
            switch (type) {
                case 'url_completed':
                    this.crawler.log(`📢 URL завершен другой вкладкой: ${data.url}`, 'debug');
                    break;
                case 'url_redistributed':
                    this.crawler.log(`📢 URL перераспределен: ${data.url}`, 'debug');
                    break;
                case 'tab_cleanup':
                    this.crawler.log(`📢 Очистка мертвой вкладки: ${data.tabId}`, 'debug');
                    break;
            }
        }

        async destroy() {
            this.isActive = false;
            if (this.heartbeatInterval) {
                clearInterval(this.heartbeatInterval);
            }
            if (this.syncChannel) {
                this.syncChannel.close();
            }
            if (this.crawler.db) {
                const transaction = this.crawler.db.transaction([CONFIG.TAB_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(CONFIG.TAB_STORE_NAME);
                store.delete(this.tabId);
            }
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

            this.tabSync = null;
            this.currentBatch = [];
            this.batchIndex = 0;
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
                await this.initDB();
                this.tabSync = new TabSyncManager(this);
                const syncInitialized = await this.tabSync.init();
                if (!syncInitialized) {
                    this.log('⚠️ TabSync не инициализирован, работаем в одиночном режиме', 'warning');
                }
                const currentUrl = this.cleanUrl(window.location.href);
                const existing = await this.getUrlFromDB(currentUrl);
                if (!existing) {
                    await this.saveUrlToDB(currentUrl, 0, null, 'completed');
                    this.log(`✅ Текущий URL сохранен: ${currentUrl}`);
                }
                await this.loadCrawlerStatus();
                this.log('🕷️ SiteCrawler инициализирован');
                return true;
            } catch (error) {
                this.handleError('Ошибка инициализации краулера', error);
                return false;
            }
        }

        async initDB() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(CONFIG.CRAWLER_DB_NAME, CONFIG.CRAWLER_DB_VERSION);
                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    this.db = request.result;
                    resolve();
                };
                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(CONFIG.CRAWLER_STORE_NAME)) {
                        const urlStore = db.createObjectStore(CONFIG.CRAWLER_STORE_NAME, { keyPath: 'url' });
                        urlStore.createIndex('status', 'status', { unique: false });
                        urlStore.createIndex('depth', 'depth', { unique: false });
                    }
                    if (!db.objectStoreNames.contains(CONFIG.TAB_STORE_NAME)) {
                        db.createObjectStore(CONFIG.TAB_STORE_NAME, { keyPath: 'id' });
                    }
                    if (!db.objectStoreNames.contains(CONFIG.LOCK_STORE_NAME)) {
                        db.createObjectStore(CONFIG.LOCK_STORE_NAME, { keyPath: 'url' });
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
            this.isRunning = true;
            this.log('🚀 Запуск мультивкладочного краулера...');
            try {
                await this.processCurrentPage();
                while (this.isRunning) {
                    const batch = await this.tabSync.getNextBatch();
                    if (batch.length === 0) {
                        this.log('📭 Нет URL для обработки, ожидание...');
                        await new Promise(resolve => setTimeout(resolve, CONFIG.CHECK_INTERVAL));
                        continue;
                    }
                    this.currentBatch = batch;
                    this.batchIndex = 0;
                    for (const urlData of batch) {
                        if (!this.isRunning) break;
                        const acquired = await this.tabSync.acquireUrlLock(urlData.url);
                        if (acquired) {
                            await this.processUrl(urlData);
                        }
                        this.batchIndex++;
                    }
                    await new Promise(resolve => setTimeout(resolve, CONFIG.CRAWL_DELAY));
                }
            } catch (error) {
                this.handleError('Ошибка работы краулера', error);
            } finally {
                this.isRunning = false;
                if (this.tabSync) {
                    await this.tabSync.destroy();
                }
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
            try {
                const currentUrl = this.cleanUrl(window.location.href);
                this.log(`🔍 Обработка текущей страницы: ${currentUrl}`);
                await this.markUrlAsProcessed(currentUrl, 'processing');
                await this.discoverLinksOnCurrentPage();

                // Запуск DynamicContentDetector
                if (typeof detector !== 'undefined') {
                    this.log('🤖 Запуск динамического детектора...');
                    return new Promise((resolve) => {
                        const originalOnComplete = detector.options.onComplete;
                        detector.options.onComplete = (results) => {
                            this.log('✅ Детектор завершил работу', results);
                            if (originalOnComplete) {
                                originalOnComplete(results);
                            }
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


        async processUrl(urlData) {
            const { url } = urlData;
            this.log(`🌐 Переход на URL: ${url}`);
            try {
                const originalUrl = window.location.href;
                window.location.href = url;
                await new Promise(resolve => {
                    const checkLoad = () => {
                        if (window.location.href === url && document.readyState === 'complete') {
                            resolve();
                        } else {
                            setTimeout(checkLoad, 500);
                        }
                    };
                    checkLoad();
                });

                // Запуск DynamicContentDetector
                if (typeof detector !== 'undefined') {
                    this.log('🤖 Запуск детектора на новой странице...');
                    await new Promise((resolve) => {
                        const originalOnComplete = detector.options.onComplete;
                        detector.options.onComplete = (results) => {
                            this.log('✅ Детектор завершил работу на новой странице', results);
                            if (originalOnComplete) {
                                originalOnComplete(results);
                            }
                            resolve();
                        };
                        detector.start();
                    });
                }

                await this.discoverLinksOnCurrentPage();
                await this.tabSync.releaseUrlLock(url, 'completed');
                this.crawledCount++;
                this.log(`✅ URL обработан: ${url}`);
            } catch (error) {
                this.handleError(`Ошибка обработки URL ${url}`, error);
                await this.tabSync.releaseUrlLock(url, 'processing_error');
            }
        }

        async discoverLinksOnCurrentPage() {
            const currentUrl = window.location.href;
            const currentCleanUrl = this.cleanUrl(currentUrl);

            // Определяем базовый href из <base>, если есть
            let baseHref = currentUrl;
            const baseEl = document.querySelector('base[href]');
            if (baseEl) {
                try {
                    baseHref = new URL(baseEl.getAttribute('href'), currentUrl).href;
                    this.log(`🐛 Используем base href: ${baseHref}`, 'debug');
                } catch (e) {
                    this.log(`❌ Ошибка разбора base href: ${e.message}`, 'debug');
                    baseHref = currentUrl;
                }
            }

            const foundLinks = new Set();
            const links = document.querySelectorAll('a[href]');
            this.log(`🔗 Найдено ${links.length} ссылок на странице`);

            const urlsToCheck = [];
            for (const link of links) {
                try {
                    const href = link.getAttribute('href');
                    if (!href || !href.trim()) continue;

                    let absoluteUrl;
                    try {
                        // Разрешаем относительно baseHref
                        absoluteUrl = new URL(href, baseHref).href;
                    } catch (urlError) {
                        this.log(`⚠️ Некорректный URL: ${href}`, 'debug');
                        continue;
                    }

                    // Первичная валидация по протоколу/домену/длине и т.п.
                    if (!this.isValidCrawlableUrl(absoluteUrl)) {
                        continue;
                    }

                    const cleanUrl = this.cleanUrl(absoluteUrl);

                    // Пропускаем текущую страницу
                    if (cleanUrl === currentCleanUrl) {
                        this.log(`🔄 Пропуск текущей страницы: ${cleanUrl}`, 'debug');
                        continue;
                    }
                    // Пропускаем по паттернам
                    if (this.shouldSkipUrl(cleanUrl)) {
                        this.log(`🚫 URL пропущен по паттерну: ${cleanUrl}`, 'debug');
                        continue;
                    }

                    // Проверяем, есть ли в БД
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

            // Проверяем доступность найденных ссылок
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

                        // Если был редирект, сохраняем исходный как обработанный
                        if (availability.redirected && finalUrl !== url) {
                            await this.saveUrlToDB(url, this.currentDepth + 1, currentUrl, 'redirect_processed');
                        }
                    } else {
                        // URL недоступен, сохраняем с ошибочным статусом
                        await this.saveUrlToDB(url, this.currentDepth + 1, currentUrl, `error_${availability.status}`);
                        this.log(`❌ URL недоступен (${availability.status}): ${url}`, 'debug');
                    }

                    // Пауза между проверками
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (error) {
                    this.handleError(`Ошибка проверки URL ${url}`, error);
                    await this.saveUrlToDB(url, this.currentDepth + 1, currentUrl, 'check_error');
                }
            }

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
                // pathname = pathname.replace(/\/\.$/, '/'); // убираем /. в конце
                // pathname = pathname.replace(/\/\.\//g, '/'); // убираем /./ в середине

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

        async stop() {
            this.log('🛑 Остановка краулера...');
            this.isRunning = false;
            if (this.tabSync) {
                await this.tabSync.destroy();
            }
            this.saveCrawlerStatus();
            this.showFinalStats();
        }



        async reset() {
            this.isRunning = false;
            if (this.tabSync) {
                await this.tabSync.destroy();
            }
            const dbDeleteReq = indexedDB.deleteDatabase(CONFIG.CRAWLER_DB_NAME);
            dbDeleteReq.onsuccess = () => console.log('IndexedDB удалена');
            dbDeleteReq.onerror = () => console.error('Ошибка при удалении IndexedDB');
            localStorage.removeItem('crawlerStatus');
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
                enableHover: false,         // эмулировать наведение курсора
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

            this.selectors = { // Селекторы для поиска интерактивных элементов
                interactive: [ // Элементы, с которыми можно взаимодействовать
                    'button', 'input', 'textarea', 'select', 'a[href]', // основные интерактивные элементы
                    '[onclick]', '[onmouseover]', '[onmouseenter]', '[onmouseleave]', // события клика и наведения
                    '[onfocus]', '[onblur]', '[onchange]', '[onsubmit]', // события фокуса и изменения
                    '[tabindex]:not([tabindex="-1"])', '[role="button"]', // элементы с tabindex и ролью кнопки
                    '[role="tab"]', '[role="menuitem"]', '[role="link"]', // дополнительные роли
                    '.btn', '.button', '.link', '.clickable' // популярные классы для кнопок и ссылок
                ],

                stateful: [ // Элементы с изменяемым состоянием
                    '.active', '.selected', '.expanded', '.collapsed', '.open', '.closed',
                    '.visible', '.hidden', '.show', '.hide', '.current', '.disabled',
                    '.focus', '.hover', '.pressed', '.checked', '.loading'
                ],

                components: [ // Компоненты и виджеты
                    '.modal', '.popup', '.dropdown', '.tooltip', '.accordion', '.tab',
                    '.slider', '.carousel', '.gallery', '.menu', '.navbar', '.sidebar',
                    '.overlay', '.dialog', '.panel', '.card', '.widget', '.component',
                    '.swiper', '.slick', '.owl-carousel', '.splide'
                ],

                hoverable: [ // Элементы, на которые можно навести курсор
                    'a[href]', 'button', '.btn', '.button', '.link', '.hover',
                    '[title]', '.menu-item', '.nav-item', '.card', '.thumbnail',
                    'img[src]', '.image', '.photo', '.gallery-item',
                    '.product', '.service', '.feature'
                ],

                forms: [ // Элементы форм и ввода данных
                    'input[type="text"]', 'input[type="email"]', 'input[type="password"]',
                    'input[type="number"]', 'input[type="tel"]', 'input[type="url"]',
                    'input[type="search"]', 'input[type="checkbox"]', 'input[type="radio"]',
                    'input[type="range"]', 'input[type="date"]', 'input[type="time"]',
                    'textarea', 'select', 'form', '[contenteditable="true"]'
                ],

                media: [ // Медиа элементы
                    'video', 'audio', 'iframe', 'object', 'embed',
                    '.video-player', '.audio-player', '.media-container',
                    '.youtube-player', '.vimeo-player', '.video-wrapper'
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

            // Блокируем события выгрузки страницы
            const unloadEvents = ['beforeunload', 'unload', 'pagehide'];
            unloadEvents.forEach(eventType => {
                const handler = (e) => {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    e.returnValue = '';
                    return '';
                };
                window.addEventListener(eventType, handler, { capture: true, passive: false });
                this.originalHandlers.set(`window_${eventType}`, handler);
            });

            // Блокируем отправку форм
            const formHandler = (e) => {
                e.preventDefault();
                e.stopImmediatePropagation();
                this.log("🚫 Заблокирована отправка формы");
                return false;
            };
            document.addEventListener('submit', formHandler, { capture: true, passive: false });
            this.originalHandlers.set('submit', formHandler);

            // Улучшенная блокировка ссылок
            const linkHandler = (e) => {
                const target = e.target.closest('a[href], area[href]');
                if (target && target.href) {
                    const href = target.href.toLowerCase();
                    const currentOrigin = window.location.origin.toLowerCase();

                    // Разрешаем только якорные ссылки на той же странице
                    const isAnchor = href.includes('#') &&
                        (href.startsWith('#') || href.startsWith(currentOrigin + window.location.pathname + '#'));

                    // Разрешаем javascript: void(0) и подобные
                    const isSafeJavaScript = href.startsWith('javascript:') &&
                        (href.includes('void(0)') || href.includes('return false'));

                    // Разрешаем специальные протоколы
                    const isSpecialProtocol = href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('sms:');

                    if (!isAnchor && !isSafeJavaScript && !isSpecialProtocol) {
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        this.log(`🚫 Заблокирован переход: ${target.href}`);
                        return false;
                    }
                }
            };
            document.addEventListener('click', linkHandler, { capture: true, passive: false });
            this.originalHandlers.set('click', linkHandler);

            // Блокируем изменения истории
            const originalPushState = history.pushState.bind(history);
            const originalReplaceState = history.replaceState.bind(history);

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

            // Блокируем window.open
            const originalWindowOpen = window.open.bind(window);
            window.open = function () {
                console.log("🚫 Заблокирован window.open");
                return null;
            };
            this.originalHandlers.set('windowOpen', originalWindowOpen);
        }


        // Метод для разблокировки навигации
        unblockNavigation() {
            if (!this.isNavigationBlocked) return;
            this.log("🔓 Разблокировка навигации");

            this.originalHandlers.forEach((handler, key) => {
                try {
                    if (key === 'pushState') {
                        history.pushState = handler;
                    } else if (key === 'replaceState') {
                        history.replaceState = handler;
                    } else if (key === 'windowOpen') {
                        window.open = handler;
                    } else if (key.startsWith('window_')) {
                        const eventType = key.replace('window_', '');
                        window.removeEventListener(eventType, handler, { capture: true });
                    } else {
                        document.removeEventListener(key, handler, { capture: true });
                    }
                } catch (error) {
                    console.warn(`Ошибка при разблокировке ${key}:`, error);
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
            const href = element.href;

            try {
                // Проверяем на деструктивные элементы
                if (this.isDestructiveElement(element)) {
                    this.simulateVisualClick(element);
                    return true;
                }

                // Специальная обработка ссылок
                if (tagName === 'a' && href) {
                    const isNavigation = this.isNavigationLink(href);
                    if (isNavigation) {
                        this.log(`🚫 Пропущена навигационная ссылка: ${href}`);
                        this.simulateVisualClick(element);
                        return true;
                    }
                }

                // Безопасные кнопки
                if (tagName === 'button' || type === 'button') {
                    // Проверяем атрибуты формы
                    if (element.form && (element.type === 'submit' || element.getAttribute('type') === 'submit')) {
                        this.simulateVisualClick(element);
                        return true;
                    }

                    // Обычные кнопки - безопасно кликаем
                    const clickEvent = new MouseEvent('click', {
                        bubbles: true,
                        cancelable: true,
                        view: window
                    });
                    element.dispatchEvent(clickEvent);
                    return true;
                }

                // Элементы форм
                if (['input', 'select', 'textarea'].includes(tagName)) {
                    if (type === 'submit' || type === 'reset') {
                        this.simulateVisualClick(element);
                        return true;
                    }

                    // Обычные поля ввода - только фокус
                    this.simulateFocus(element);
                    return true;
                }

                // Все остальные элементы - визуальная симуляция
                this.simulateVisualClick(element);
                return true;

            } catch (error) {
                this.handleError('Ошибка безопасного клика', error, element);
                return false;
            }
        }

        simulateFocus(element) {
            if (!element) return;

            try {
                // Событие фокуса
                element.dispatchEvent(new FocusEvent('focus', { bubbles: true }));

                // Визуальное выделение
                const originalOutline = element.style.outline;
                element.style.outline = '2px solid #007bff';

                setTimeout(() => {
                    // Событие потери фокуса
                    element.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
                    element.style.outline = originalOutline;
                }, 200);

                this.state.processedElements.add(element);
            } catch (error) {
                this.handleError('Ошибка симуляции фокуса', error, element);
            }
        }

        isNavigationLink(href) {
            if (!href) return false;

            const url = href.toLowerCase();
            const currentOrigin = window.location.origin.toLowerCase();
            const currentPath = window.location.pathname;

            // Якорные ссылки на той же странице - безопасны
            const isCurrentPageAnchor = url.includes('#') &&
                (url.startsWith('#') || url.startsWith(currentOrigin + currentPath + '#'));

            // Специальные протоколы - безопасны
            const isSpecialProtocol = url.startsWith('mailto:') ||
                url.startsWith('tel:') ||
                url.startsWith('sms:') ||
                url.startsWith('skype:');

            // JavaScript void - безопасны
            const isSafeJS = url.startsWith('javascript:') &&
                (url.includes('void(0)') || url.includes('return false') || url === 'javascript:;');

            // Если это безопасные ссылки - не навигация
            if (isCurrentPageAnchor || isSpecialProtocol || isSafeJS) {
                return false;
            }

            // Все остальные HTTP(S) ссылки считаем навигационными
            return url.startsWith('http') || url.startsWith('/') || url.startsWith('../');
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
                { name: 'Улучшенная активация hover эффектов', method: 'triggerHoverEffects' },
                { name: 'Обработка каруселей и слайдеров', method: 'handleCarousels' },
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
            this.log(`🖱️ Улучшенная обработка ${hoverElements.length} hover элементов`);

            for (const element of hoverElements) {
                if (!this.isElementInteractable(element)) continue;

                try {
                    // 1. Стандартные mouse события с координатами
                    this.dispatchMouseEvent(element, 'mouseenter');
                    this.dispatchMouseEvent(element, 'mouseover');

                    // 2. Принудительная активация hover CSS
                    this.forceHoverStates(element);

                    await this.delay(this.options.mouseDelay);

                    // 3. Выход из hover
                    this.dispatchMouseEvent(element, 'mouseleave');
                    this.dispatchMouseEvent(element, 'mouseout');

                    this.state.processedElements.add(element);

                } catch (error) {
                    this.handleError(`Ошибка улучшенного hover для элемента`, error, element);
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


        async handleCarousels() {
            const carouselSelectors = [
                '.carousel', '.slider', '.swiper', '.slick', '.owl-carousel',
                '.splide', '.glide', '.flickity', '.keen-slider',
                '[data-carousel]', '[data-slider]', '[data-swiper]',
                '.gallery', '.image-slider', '.product-slider'
            ];

            const carousels = this.getAllElements(carouselSelectors);
            this.log(`🎠 Обработка ${carousels.length} каруселей`);

            for (const carousel of carousels) {
                if (!this.isElementInteractable(carousel)) continue;

                try {
                    // Ищем кнопки навигации
                    const navButtons = carousel.querySelectorAll(
                        '.prev, .next, .arrow, [data-slide], .carousel-control, .slick-arrow'
                    );

                    // Кликаем по кнопкам навигации
                    for (const button of navButtons) {
                        if (this.isElementInteractable(button)) {
                            this.safeClick(button);
                            await this.delay(this.options.clickDelay);
                        }
                    }

                    // Симулируем свайп жесты
                    this.simulateSwipeGestures(carousel);
                    await this.delay(this.options.scrollDelay);

                    // Ищем индикаторы/точки
                    const indicators = carousel.querySelectorAll(
                        '.indicator, .dot, .bullet, [data-slide-to], .carousel-indicators li'
                    );

                    for (const indicator of Array.from(indicators).slice(0, 3)) { // Ограничиваем до 3
                        if (this.isElementInteractable(indicator)) {
                            this.safeClick(indicator);
                            await this.delay(this.options.clickDelay);
                        }
                    }

                    this.state.processedElements.add(carousel);

                } catch (error) {
                    this.handleError(`Ошибка обработки карусели`, error, carousel);
                }
            }
        }

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

            // Расширенный список деструктивных селекторов
            const destructiveSelectors = [
                // Формы и кнопки отправки
                '[type="submit"]',
                'input[type="submit"]',
                'button[type="submit"]',
                'form button:not([type])', // кнопки в формах без типа (по умолчанию submit)

                // Деструктивные действия
                '.delete', '.remove', '.destroy', '.clear',
                '.logout', '.signout', '.sign-out', '.exit',
                '.cancel', '.close', '.dismiss', '.reject',
                '.unsubscribe', '.disable', '.deactivate',

                // Ссылки с деструктивными действиями
                'a[href*="delete"]', 'a[href*="remove"]',
                'a[href*="logout"]', 'a[href*="signout"]',
                'a[href*="exit"]', 'a[href*="unsubscribe"]',
                'a[href*="cancel"]', 'a[href*="destroy"]',

                // JavaScript обработчики
                '[onclick*="delete"]', '[onclick*="remove"]',
                '[onclick*="destroy"]', '[onclick*="logout"]',
                '[onclick*="submit"]', '[onclick*="window.open"]',

                // Дата-атрибуты
                '[data-action*="delete"]', '[data-action*="remove"]',
                '[data-action*="destroy"]', '[data-action*="logout"]',
                '[data-action*="submit"]', '[data-method="delete"]',

                // Специальные роли
                '[role="button"][aria-label*="delete"]',
                '[role="button"][aria-label*="remove"]'
            ];

            // Проверяем селекторы
            const matchesDestructive = destructiveSelectors.some(selector => {
                try {
                    return element.matches(selector);
                } catch {
                    return false;
                }
            });

            if (matchesDestructive) return true;

            // Проверяем текстовое содержимое
            const text = (element.textContent || element.value || element.title || element.alt || '').toLowerCase().trim();
            const destructiveWords = [ // расширенный список слов
                'delete', 'remove', 'destroy', 'clear', 'reset',
                'logout', 'log out', 'sign out', 'signout', 'exit',
                'cancel', 'close', 'dismiss', 'reject', 'decline',
                'unsubscribe', 'disable', 'deactivate', 'suspend',
                'submit', 'send', 'post', 'save', 'update',
                'buy', 'purchase', 'order', 'checkout', 'pay',
                'download', 'install', 'upgrade'
            ];

            const hasDestructiveText = destructiveWords.some(word => {
                return text === word || text.startsWith(word + ' ') || text.endsWith(' ' + word) || text.includes(' ' + word + ' ');
            });

            // Проверяем href на навигацию
            if (element.href && this.isNavigationLink(element.href)) {
                return true;
            }

            return hasDestructiveText;
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
            if (!element) return;

            const rect = element.getBoundingClientRect();
            const center = {
                x: rect.left + rect.width / 2,
                y: rect.top + rect.height / 2
            };

            // Создаем событие с реальными координатами
            const event = new MouseEvent(eventType, {
                clientX: center.x,
                clientY: center.y,
                screenX: center.x + window.screenX,
                screenY: center.y + window.screenY,
                bubbles: true,
                cancelable: true,
                view: window,
                detail: eventType === 'click' ? 1 : 0
            });

            element.dispatchEvent(event);

            // Дополнительно: пытаемся активировать CSS hover через focus/blur
            if (eventType === 'mouseenter' && element.focus) {
                try {
                    element.focus();
                    setTimeout(() => element.blur(), 100);
                } catch (e) { }
            }
        }

        forceHoverStates(element) {
            if (!element) return;

            // Создаем временный CSS для принудительной активации hover
            const testId = 'hover-test-' + Date.now();
            const style = document.createElement('style');

            // Получаем все CSS правила для этого элемента
            const computedStyle = window.getComputedStyle(element);
            const elementSelectors = this.getElementSelectors(element);

            // Создаем CSS правила для принудительного hover
            let hoverCSS = '';
            elementSelectors.forEach(selector => {
                hoverCSS += `
                    ${selector}.${testId},
                    ${selector}.${testId}:hover {
                        transition: all 0.1s ease !important;
                    }
                `;
            });

            style.textContent = hoverCSS;
            document.head.appendChild(style);

            // Применяем класс
            element.classList.add(testId);

            // Удаляем через короткий промежуток
            setTimeout(() => {
                element.classList.remove(testId);
                style.remove();
            }, 500);
        }

        getElementSelectors(element) {
            const selectors = [];

            // ID селектор
            if (element.id) {
                selectors.push('#' + element.id);
            }

            // Class селекторы
            if (element.classList.length > 0) {
                const classSelector = '.' + Array.from(element.classList).join('.');
                selectors.push(classSelector);
            }

            // Tag селектор
            selectors.push(element.tagName.toLowerCase());

            return selectors;
        }

        simulateSwipeGestures(element) {
            if (!element) return;

            const rect = element.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;

            // Симулируем свайп влево
            this.performSwipe(element, {
                startX: rect.left + rect.width * 0.8,
                endX: rect.left + rect.width * 0.2,
                y: centerY
            });

            // Пауза между жестами
            setTimeout(() => {
                // Симулируем свайп вправо
                this.performSwipe(element, {
                    startX: rect.left + rect.width * 0.2,
                    endX: rect.left + rect.width * 0.8,
                    y: centerY
                });
            }, 1000);
        }

        performSwipe(element, coords) {
            // TouchEvent может не поддерживаться в некоторых браузерах
            try {
                const touchStart = new TouchEvent('touchstart', {
                    touches: [{
                        clientX: coords.startX,
                        clientY: coords.y,
                        target: element
                    }],
                    bubbles: true,
                    cancelable: true
                });

                const touchMove = new TouchEvent('touchmove', {
                    touches: [{
                        clientX: (coords.startX + coords.endX) / 2,
                        clientY: coords.y,
                        target: element
                    }],
                    bubbles: true,
                    cancelable: true
                });

                const touchEnd = new TouchEvent('touchend', {
                    changedTouches: [{
                        clientX: coords.endX,
                        clientY: coords.y,
                        target: element
                    }],
                    bubbles: true,
                    cancelable: true
                });

                element.dispatchEvent(touchStart);
                setTimeout(() => element.dispatchEvent(touchMove), 50);
                setTimeout(() => element.dispatchEvent(touchEnd), 150);

            } catch (error) {
                // Fallback: используем обычные mouse события для drag
                this.simulateDragGesture(element, coords);
            }
        }


        simulateDragGesture(element, coords) {
            const mouseDown = new MouseEvent('mousedown', {
                clientX: coords.startX,
                clientY: coords.y,
                bubbles: true,
                cancelable: true
            });

            const mouseMove = new MouseEvent('mousemove', {
                clientX: coords.endX,
                clientY: coords.y,
                bubbles: true,
                cancelable: true
            });

            const mouseUp = new MouseEvent('mouseup', {
                clientX: coords.endX,
                clientY: coords.y,
                bubbles: true,
                cancelable: true
            });

            element.dispatchEvent(mouseDown);
            setTimeout(() => element.dispatchEvent(mouseMove), 50);
            setTimeout(() => element.dispatchEvent(mouseUp), 150);
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
