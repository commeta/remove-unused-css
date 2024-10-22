<?php
/*
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2024 Commeta
 * Released under the GPL v3 or MIT license
 * 
 */


// Файл для хранения общего массива неиспользуемых правил
$storageFile = __DIR__ . '/unused_rules.json';

// Получаем данные из POST-запроса
$data = file_get_contents('php://input');
if (!$data) {
    http_response_code(400);
    exit('Нет данных для обработки.');
}

$receivedData = json_decode($data, true);
if (json_last_error() !== JSON_ERROR_NONE) {
    http_response_code(400);
    exit('Неверный формат JSON.');
}

// Загружаем общий массив неиспользуемых правил
if (file_exists($storageFile)) {
    $unusedRules = json_decode(file_get_contents($storageFile), true);
    if (json_last_error() !== JSON_ERROR_NONE) {
        $unusedRules = [];
    }
} else {
    $unusedRules = [];
}

// Функция для преобразования относительных путей в абсолютные
function resolvePath($basePath, $relativePath) {
    if (parse_url($relativePath, PHP_URL_SCHEME) != '') {
        // Это абсолютный URL
        return $relativePath;
    }
    // Нормализуем пути
    $basePath = rtrim(str_replace('\\', '/', $basePath), '/') . '/';
    $relativePath = str_replace('\\', '/', $relativePath);
    $path = $basePath . $relativePath;
    $parts = array_filter(explode('/', $path), 'strlen');
    $absolutes = [];
    foreach ($parts as $part) {
        if ('.' == $part) continue;
        if ('..' == $part) {
            array_pop($absolutes);
        } else {
            $absolutes[] = $part;
        }
    }
    return '/' . implode('/', $absolutes);
}

// Обрабатываем полученные данные
foreach ($receivedData as $sheetData) {
    $stylesheetPath = $sheetData['stylesheet'];
    // Преобразуем относительный путь в абсолютный
    $stylesheetPath = resolvePath($_SERVER['DOCUMENT_ROOT'], $stylesheetPath);

    // Проверяем, что файл стиля находится на сервере
    if (strpos($stylesheetPath, $_SERVER['DOCUMENT_ROOT']) !== 0) {
        continue; // Игнорируем внешние стили
    }

    // Инициализируем массив правил для данного файла, если его еще нет
    if (!isset($unusedRules[$stylesheetPath])) {
        $unusedRules[$stylesheetPath] = [];
    }

    foreach ($sheetData['rules'] as $rule) {
        $ruleKey = md5($rule['cssText']);

        // Если правило уже есть в общем массиве, пропускаем
        if (isset($unusedRules[$stylesheetPath][$ruleKey])) {
            continue;
        }

        // Добавляем правило в общий массив неиспользуемых правил
        $unusedRules[$stylesheetPath][$ruleKey] = $rule['cssText'];
    }
}

// Сохраняем обновленный общий массив неиспользуемых правил
file_put_contents($storageFile, json_encode($unusedRules));

// Функция для очистки CSS файлов от неиспользуемых правил
function cleanCssFiles($unusedRules) {
    $cleanCssDir = __DIR__ . '/clean-css';
    if (!is_dir($cleanCssDir)) {
        mkdir($cleanCssDir, 0777, true);
    }

    foreach ($unusedRules as $stylesheetPath => $rules) {
        // Проверяем, что оригинальный файл существует
        if (!file_exists($stylesheetPath)) {
            continue;
        }

        // Содержимое оригинального файла
        $cssContent = file_get_contents($stylesheetPath);

        // Парсинг CSS с помощью CssParser
        require_once 'vendor/autoload.php';
        $parser = new Sabberworm\CSS\Parser($cssContent);
        $cssDocument = $parser->parse();

        // Удаляем неиспользуемые правила
        foreach ($cssDocument->getAllDeclarationBlocks() as $block) {
            $cssText = $block->render();
            $ruleKey = md5($cssText);
            if (isset($rules[$ruleKey])) {
                $cssDocument->remove($block);
            }
        }

        // Удаляем неиспользуемые @media, @font-face, @keyframes и т.д.
        foreach ($cssDocument->getContents() as $content) {
            if ($content instanceof Sabberworm\CSS\CSSList\AtRuleBlockList) {
                $cssText = $content->render();
                $ruleKey = md5($cssText);
                if (isset($rules[$ruleKey])) {
                    $cssDocument->remove($content);
                }
            }
        }

        // Путь для сохранения очищенного файла
        $relativePath = str_replace($_SERVER['DOCUMENT_ROOT'], '', $stylesheetPath);
        $cleanFilePath = $cleanCssDir . $relativePath;

        // Создаем нужные директории
        $cleanFileDir = dirname($cleanFilePath);
        if (!is_dir($cleanFileDir)) {
            mkdir($cleanFileDir, 0777, true);
        }

        // Сохраняем очищенный CSS
        file_put_contents($cleanFilePath, $cssDocument->render());
    }
}

// Очищаем CSS файлы от неиспользуемых правил
cleanCssFiles($unusedRules);

// Отправляем ответ клиенту
echo 'Неиспользуемый CSS успешно обработан.';
