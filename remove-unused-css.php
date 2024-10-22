<?php
/*
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2024 Commeta
 * Released under the GPL v3 or MIT license
 * 
 */

// Подключаем autoload для sabberworm/php-css-parser
require_once 'vendor/autoload.php';

use Sabberworm\CSS\Parser;
use Sabberworm\CSS\CSSList\Document;
use Sabberworm\CSS\Value\URL;

/**
 * Главный скрипт для приема данных неиспользуемых CSS-селекторов
 * Сохраняет общий массив неиспользуемых правил и создает очищенные CSS-файлы
 */

// Файл для хранения глобального массива селекторов
define('SELECTORS_FILE', 'data/unused_selectors.ser');

// Каталог для сохранения очищенных CSS-файлов
define('CLEAN_CSS_DIR', dirname(__DIR__) . '/clean-css/');

// Получаем данные POST
$inputJSON = file_get_contents('php://input');
$data = json_decode($inputJSON, true);

if (!$data) {
    http_response_code(400);
    echo 'Invalid JSON data';
    exit;
}

// Проверяем наличие файла с селекторами или инициализируем массив
if (file_exists(SELECTORS_FILE)) {
    $masterSelectors = unserialize(file_get_contents(SELECTORS_FILE));
} else {
    $masterSelectors = [];
    
    initializeMasterSelectors($masterSelectors);
    file_put_contents(SELECTORS_FILE, serialize($masterSelectors));
}

// Обновляем статус селекторов на основе полученных данных
updateSelectorsUsage($masterSelectors, $data);

// Сохраняем обновленные селекторы
file_put_contents(SELECTORS_FILE, serialize($masterSelectors));

// Создаем очищенные CSS-файлы
cleanCssFiles($masterSelectors);

echo 'Данные успешно обработаны';

/**
 * Инициализирует массив селекторов, парсит все CSS-файлы на сервере
 */
function initializeMasterSelectors(&$masterSelectors){
    $cssFiles = findCssFiles($_SERVER['DOCUMENT_ROOT']);
    
    foreach ($cssFiles as $filePath) {
        $relativePath = getRelativePath($filePath);
        parseCssFile($filePath, $relativePath, $masterSelectors);
    }
}

/**
 * Обновляет статус селекторов на основе полученных данных от страниц
 */
function updateSelectorsUsage(&$masterSelectors, $data){
    foreach ($data as $href => $selectors) {
        $relativePath = getFilePathFromHref($href);
        
        if (!isset($masterSelectors[$relativePath])) {
            continue;
        }
        
        $unusedSelectors = array_column($selectors, 'selector');
        
        foreach ($masterSelectors[$relativePath] as $selector => &$status) {
            if (!in_array($selector, $unusedSelectors)) {
                $status = 'used';
            }
        }
    }
}

/**
 * Создает очищенные CSS-файлы, вырезая неиспользуемые правила
 */
function cleanCssFiles($masterSelectors){
    foreach ($masterSelectors as $relativePath => $selectors) {
        $filePath = $_SERVER['DOCUMENT_ROOT'] . $relativePath;
        
        if (!file_exists($filePath)) {
            continue;
        }
        
        $cssContent = file_get_contents($filePath);
        $parser = new Parser($cssContent);
        $cssDoc = $parser->parse();
        
        removeUnusedRules($cssDoc, $selectors, dirname($filePath));
        
        $cleanCssPath = CLEAN_CSS_DIR . $relativePath;
        
        ensureDirectoryExists(dirname($cleanCssPath));
        
        file_put_contents($cleanCssPath, $cssDoc->render());
    }
}

/**
 * Рекурсивно удаляет неиспользуемые правила из CSS-документа
 */
function removeUnusedRules(Document $cssDoc, $selectorsStatus, $baseDir){
    foreach ($cssDoc->getContents() as $key => $rule) {
        if ($rule instanceof Sabberworm\CSS\RuleSet\DeclarationBlock) {
            $selectorObjects = $rule->getSelectors();
            $unused = true;
            
            foreach ($selectorObjects as $selectorObj) {
                $selector = (string)$selectorObj;
                
                if (isset($selectorsStatus[$selector]) && $selectorsStatus[$selector] === 'used') {
                    $unused = false;
                    break;
                }
            }
            
            if ($unused) {
                $cssDoc->remove($rule);
            }
        } elseif ($rule instanceof Sabberworm\CSS\CSSList\AtRuleBlock) {
            removeUnusedRules($rule, $selectorsStatus, $baseDir);
            
            if (empty($rule->getContents())) {
                $cssDoc->remove($rule);
            }
        } elseif ($rule instanceof Sabberworm\CSS\Property\AtRule) {
            // Обрабатываем @import
            // ...
        }
    }
}

/**
 * Парсит CSS-файл и добавляет селекторы в masterSelectors
 */
function parseCssFile($filePath, $relativePath, &$masterSelectors){
    $cssContent = file_get_contents($filePath);
    $parser = new Parser($cssContent);
    $cssDoc = $parser->parse();

    $selectors = [];

    collectSelectors($cssDoc, $selectors);

    foreach ($selectors as $selector) {
        $masterSelectors[$relativePath][$selector] = $masterSelectors[$relativePath][$selector] ?? 'unused';
    }
}

/**
 * Собирает селекторы из CSS-документа
 */
function collectSelectors(Document $cssDoc, &$selectors){
    foreach ($cssDoc->getContents() as $rule) {
        if ($rule instanceof Sabberworm\CSS\RuleSet\DeclarationBlock) {
            $selectorObjects = $rule->getSelectors();
            
            foreach ($selectorObjects as $selectorObj) {
                $selectors[] = (string)$selectorObj;
            }
        } elseif ($rule instanceof Sabberworm\CSS\CSSList\AtRuleBlock) {
            collectSelectors($rule, $selectors);
        }
    }
}

/**
 * Ищет все CSS-файлы в указанном каталоге
 */
function findCssFiles($dir){
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir));
    $cssFiles = [];
    
    foreach ($iterator as $file) {
        if ($file->isFile() && strtolower($file->getExtension()) === 'css') {
            $cssFiles[] = $file->getPathname();
        }
    }
    
    return $cssFiles;
}

/**
 * Получает относительный путь файла от корня документа
 */
function getRelativePath($filePath){
    return str_replace($_SERVER['DOCUMENT_ROOT'], '', realpath($filePath));
}

/**
 * Преобразует href в путь файла на сервере
 */
function getFilePathFromHref($href){
    $urlComponents = parse_url($href);
    $path = $urlComponents['path'] ?? '';
    
    return $path;
}

/**
 * Обеспечивает существование каталога
 */
function ensureDirectoryExists($directory){
    if (!file_exists($directory)) {
        mkdir($directory, 0777, true);
    }
}

/**
 * Парсит URL из @import правила
 */
function parseImportUrl($args, $baseDir){
    $url = trim($args, ' \'\"');
    
    if (strpos($url, 'url(') === 0) {
        $url = substr($url, 4, -1);
    }
    
    if (!preg_match('#^https?://#', $url)) {
        $importPath = realpath($baseDir . '/' . $url);
        if ($importPath && file_exists($importPath)) {
            return $importPath;
        }
    }
    
    return null;
}
