/*!
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2024 Commeta
 * Released under the GPL v3 or MIT license
 * 
 */
(function() {
    // Запускаем код после загрузки DOM
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }

    function init() {
        const processedStylesheets = new Set(); // Чтобы избежать повторной обработки стилей
        const stylesheetsData = {}; // Хранит данные о всех стилях

        // Начинаем обработку стилей
        [...document.styleSheets].forEach(sheet => {
            try {
                processStylesheet(sheet);
            } catch (e) {
                console.warn('Не удалось получить доступ к стилю:', sheet.href, e);
            }
        });

        // Создаем плавающую кнопку
        createFloatingButton();

        // Функция для обработки стиля
        function processStylesheet(sheet) {
            if (processedStylesheets.has(sheet)) {
                return;
            }
            processedStylesheets.add(sheet);

            const href = sheet.href || 'inline';

            if (!stylesheetsData[href]) {
                stylesheetsData[href] = {
                    rules: [],
                    href: sheet.href,
                    type: sheet.ownerNode ? sheet.ownerNode.nodeName : 'unknown'
                };
            }

            let rules;
            try {
                rules = sheet.cssRules;
            } catch (e) {
                console.warn('Не могу получить cssRules из стиля:', href, e);
                // Пытаемся загрузить стиль через fetch, если CORS разрешает
                if (sheet.href) {
                    fetchStylesheet(sheet.href, sheet);
                }
                return;
            }

            for (let i = 0; i < rules.length; i++) {
                const rule = rules[i];

                if (rule.type === CSSRule.STYLE_RULE) {
                    stylesheetsData[href].rules.push({
                        selectorText: rule.selectorText,
                        cssText: rule.cssText,
                        media: null
                    });
                } else if (rule.type === CSSRule.MEDIA_RULE) {
                    // Обрабатываем правила @media
                    const media = rule.media.mediaText;
                    for (let j = 0; j < rule.cssRules.length; j++) {
                        const mediaRule = rule.cssRules[j];
                        if (mediaRule.type === CSSRule.STYLE_RULE) {
                            stylesheetsData[href].rules.push({
                                selectorText: mediaRule.selectorText,
                                cssText: mediaRule.cssText,
                                media: media
                            });
                        }
                    }
                } else if (rule.type === CSSRule.IMPORT_RULE) {
                    // Обрабатываем импортированные стили
                    try {
                        if (rule.styleSheet) {
                            processStylesheet(rule.styleSheet);
                        }
                    } catch (e) {
                        console.warn('Не могу получить доступ к импортированному стилю:', rule.href, e);
                        // Пытаемся загрузить стиль через fetch, если CORS разрешает
                        if (rule.href) {
                            fetchStylesheet(rule.href);
                        }
                    }
                }
                // Здесь можно добавить обработку других типов правил (@font-face, @keyframes и т.д.)
            }
        }

        // Функция для загрузки стилей через fetch API для кросс-доменных стилей
        function fetchStylesheet(url, parentSheet) {
            fetch(url).then(response => {
                if (response.ok) {
                    return response.text();
                }
                throw new Error('Не удалось загрузить стиль: ' + url);
            }).then(cssText => {
                // Создаем новый элемент style
                const style = document.createElement('style');
                style.textContent = cssText;
                document.head.appendChild(style);
                // Обрабатываем только что добавленный стиль
                const newSheet = style.sheet;
                processStylesheet(newSheet);
            }).catch(error => {
                console.warn('Ошибка при загрузке стиля:', url, error);
            });
        }

        // Функция для анализа использования селекторов
        function analyzeUsage() {
            const unusedRulesByStylesheet = {};

            for (const href in stylesheetsData) {
                const stylesheet = stylesheetsData[href];
                const unusedRules = [];
                stylesheet.rules.forEach(rule => {
                    const selectors = rule.selectorText.split(',').map(s => s.trim());
                    let isUsed = false;
                    selectors.forEach(selector => {
                        const baseSelector = stripPseudoClasses(selector);
                        if (isSelectorValid(baseSelector) && isSelectorUsed(baseSelector)) {
                            isUsed = true;
                        }
                    });
                    if (!isUsed) {
                        unusedRules.push(rule);
                    }
                });
                if (unusedRules.length > 0) {
                    unusedRulesByStylesheet[href] = unusedRules;
                }
            }

            return unusedRulesByStylesheet;
        }

        // Функция для удаления псевдоклассов и псевдоэлементов из селекторов
        function stripPseudoClasses(selector) {
            // Удаляем псевдоклассы и псевдоэлементы
            return selector.replace(/::?[a-zA-Z-]+(\(.*\))?/g, '');
        }

        // Функция для проверки валидности селектора
        function isSelectorValid(selector) {
            try {
                document.querySelector(selector);
                return true;
            } catch (e) {
                return false;
            }
        }

        // Функция для проверки использования селектора на странице
        function isSelectorUsed(selector) {
            try {
                const elements = document.querySelectorAll(selector);
                return elements.length > 0;
            } catch (e) {
                console.warn('Невалидный селектор:', selector, e);
                return false;
            }
        }

        // Функция для создания плавающей кнопки
        function createFloatingButton() {
            const button = document.createElement('button');
            button.textContent = 'Отправить неиспользуемый CSS';
            button.style.position = 'fixed';
            button.style.bottom = '20px';
            button.style.right = '20px';
            button.style.zIndex = '9999';
            button.style.padding = '10px 20px';
            button.style.backgroundColor = '#f00';
            button.style.color = '#fff';
            button.style.border = 'none';
            button.style.borderRadius = '5px';
            button.style.cursor = 'pointer';
            button.addEventListener('click', () => {
                const unusedRulesByStylesheet = analyzeUsage();

                // Подготавливаем данные для отправки
                const dataToSend = [];
                for (const href in unusedRulesByStylesheet) {
                    const rules = unusedRulesByStylesheet[href].map(rule => ({
                        selectorText: rule.selectorText,
                        cssText: rule.cssText,
                        media: rule.media,
                    }));
                    dataToSend.push({
                        stylesheet: href,
                        rules: rules
                    });
                }

                sendDataToServer(dataToSend);
            });
            document.body.appendChild(button);
        }

        // Функция для отправки данных на сервер через fetch
        function sendDataToServer(data) {
            // Предполагаем, что серверный скрипт расположен по адресу '/remove-unused-css.php'
            fetch('/remove-unused-css.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data),
            }).then(response => {
                if (response.ok) {
                    console.log('Неиспользуемый CSS успешно отправлен.');
                } else {
                    console.error('Не удалось отправить неиспользуемый CSS:', response.statusText);
                }
            }).catch(error => {
                console.error('Ошибка при отправке неиспользуемого CSS:', error);
            });
        }
    }
})();

