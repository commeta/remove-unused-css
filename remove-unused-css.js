/*!
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2024 Commeta
 * Released under the GPL v3 or MIT license
 * 
 */

(function() {
	// Создаем объект для хранения неиспользуемых селекторов
	let unusedSelectors = {};

	// Создаем объект для хранения информации о стилевых файлах
	let styleSheetsInfo = {};

	// Функция для загрузки содержимого стилевых файлов
	async function loadStyleSheetContent(href) {
		let response = await fetch(href);
		
		if (response.ok) {
			let text = await response.text();
			return text;
		} else {
			console.warn(`Не удалось загрузить стили: ${href}`);
			return '';
		}
	}

	// Функция для парсинга CSS текста и получения правил
	function parseCSSText(cssText) {
		let styleElement = document.createElement('style');
		styleElement.textContent = cssText;
		document.head.appendChild(styleElement);
		
		let rules = styleElement.sheet.cssRules;
		document.head.removeChild(styleElement);
		
		return rules;
	}

	// Функция для обработки правил стилей
	async function processStyleSheet(sheet) {
		let rules;
		
		try {
			rules = sheet.cssRules;
		} catch (e) {
			if (e.name === 'SecurityError') {
				// Кросс-доменный доступ, попробуем загрузить содержимое
				if (sheet.href && sheet.href.startsWith(window.location.origin)) {
					let cssText = await loadStyleSheetContent(sheet.href);
					
					if (cssText) {
						rules = parseCSSText(cssText);
					}
				} else {
					console.warn(`Стилевой файл на другом домене или недоступен: ${sheet.href}`);
					return;
				}
			} else {
				console.warn(`Не удалось получить правила стилей: ${e}`);
				return;
			}
		}
		
		if (!rules) return;

		// Обрабатываем правила
		for (let rule of rules) {
			if (rule.type === CSSRule.STYLE_RULE) {
				addSelector(rule.selectorText, sheet.href || 'inline', null);
			} else if (rule.type === CSSRule.MEDIA_RULE) {
				processMediaRule(rule, sheet.href || 'inline');
			} else if (rule.type === CSSRule.IMPORT_RULE) {
				await processStyleSheet(rule.styleSheet);
			}
		}
	}

	// Функция для обработки @media правил
	function processMediaRule(mediaRule, href) {
		let media = mediaRule.media.mediaText;
		
		for (let rule of mediaRule.cssRules) {
			if (rule.type === CSSRule.STYLE_RULE) {
				addSelector(rule.selectorText, href, media);
			} else if (rule.type === CSSRule.MEDIA_RULE) {
				processMediaRule(rule, href);
			}
		}
	}

	// Функция для добавления селектора в список
	function addSelector(selectorText, href, media) {
		let selectors = selectorText.split(',');
		selectors = selectors.map(s => s.trim());
		
		selectors.forEach(selector => {
			if (!unusedSelectors[selector]) {
				unusedSelectors[selector] = {
					href: href,
					media: media,
					used: false
				};
			}
		});
		
		if (!styleSheetsInfo[href]) {
			styleSheetsInfo[href] = {
				selectors: []
			};
		}
		
		styleSheetsInfo[href].selectors.push({
			selector: selectorText,
			media: media
		});
	}

	// Функция для проверки использования селекторов в DOM
	function checkSelectorsUsage() {
		let totalUnused = 0;
		
		Object.keys(unusedSelectors).forEach(selector => {
			if (!unusedSelectors[selector].used) {
				try {
					if (document.querySelector(selector)) {
						unusedSelectors[selector].used = true;
						
						// Удаляем селектор из списка неиспользуемых
						delete unusedSelectors[selector];
					}
				} catch (e) {
					// Некорректный селектор, игнорируем
				}
			}
		});
		
		totalUnused = Object.keys(unusedSelectors).length;
		
		// Обновляем статистику на кнопке
		updateButton(totalUnused);
	}

	// Функция для обновления текста на кнопке
	function updateButton(unusedCount) {
		let button = document.getElementById('unused-css-button');
		
		if (button) {
			button.textContent = unusedCount;
		}
	}

	// Функция для отправки данных на сервер
	function sendDataToServer() {
		let data = groupSelectorsByFile();
		
		fetch('/remove-unused-css.php', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify(data)
		}).then(response => {
			if (response.ok) {
				alert('Данные успешно отправлены на сервер');
			} else {
				alert('Ошибка при отправке данных на сервер');
			}
		}).catch(error => {
			alert('Ошибка при отправке данных на сервер');
			console.error(error);
		});
	}

	// Функция для группировки селекторов по файлам
	function groupSelectorsByFile() {
		let result = {};
		
		Object.keys(unusedSelectors).forEach(selector => {
			let info = unusedSelectors[selector];
			let href = info.href;
			
			if (!result[href]) {
				result[href] = [];
			}
			
			result[href].push({
				selector: selector,
				media: info.media
			});
		});
		
		return result;
	}

	// Функция для создания плавающей кнопки
	function createFloatingButton() {
		let button = document.createElement('button');
		
		button.id = 'unused-css-button';
		button.style.position = 'fixed';
		button.style.bottom = '10px';
		button.style.right = '10px';
		button.style.zIndex = '9999';
		button.style.padding = '10px 20px';
		button.style.backgroundColor = '#ff0000';
		button.style.color = '#fff';
		button.style.border = 'none';
		button.style.borderRadius = '5px';
		button.style.cursor = 'pointer';
		button.textContent = '0';
		button.addEventListener('click', sendDataToServer);
		
		document.body.appendChild(button);
	}

	// Основная функция
	async function init() {
		// Обрабатываем все стилевые листы
		for (let sheet of document.styleSheets) {
			let href = sheet.href || 'inline';
			
			if (!href.startsWith(window.location.origin)) {
				// Пропускаем файлы с другого домена
				continue;
			}
			
			await processStyleSheet(sheet);
		}
		
		// Создаем плавающую кнопку
		createFloatingButton();
		
		// Начинаем проверку использования селекторов
		setInterval(checkSelectorsUsage, 1000);
	}

	// Вызываем основную функцию
	init();

})();
