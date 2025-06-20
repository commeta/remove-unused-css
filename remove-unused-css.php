<?php
/*!
 * Remove unused CSS 
 * https://github.com/commeta/remove-unused-css
 * Copyright 2025 Commeta
 * Released under the GPL v3 or MIT license
 */

declare(strict_types=1);

if (!file_exists(__DIR__ . '/vendor/autoload.php')) {
    http_response_code(500);
    die('Composer dependencies not installed. Run: composer install');
}

require_once __DIR__ . '/vendor/autoload.php';

// Путь к файлу блокировки
const LOCK_FILE = __DIR__ . '/process.lock';

use Sabberworm\CSS\Parser;
use Sabberworm\CSS\Renderable;
use Sabberworm\CSS\OutputFormat;

use Sabberworm\CSS\CSSList\Document;
use Sabberworm\CSS\CSSList\AtRuleBlockList;

use Sabberworm\CSS\RuleSet\DeclarationBlock;
use Sabberworm\CSS\RuleSet\AtRuleSet;

use Sabberworm\CSS\Property\AtRule;

use Sabberworm\CSS\Value\URL;
use Sabberworm\CSS\Value\CSSFunction;
use Sabberworm\CSS\Value\CSSString;
use Sabberworm\CSS\Value\ValueList;
use Sabberworm\CSS\Value\RuleValueList;

class RemoveUnusedCSSProcessor
{
    // File and directory constants
    private const SELECTORS_FILE = 'data/selectors.json'; // Путь к JSON-файлу, где хранятся все найденные неиспользуемые селекторы
    private const CSS_DIR = 'css/'; // Каталог, в который записываются очищенные (минимизированные) CSS-файлы
    private const COMBINED_FILE = 'remove-unused-css.min.css'; // Имя объединённого файла со всеми минимизированными стилями
    private const MAX_FILE_SIZE = 32 * 1024 * 1024; // Максимально допустимый размер обрабатываемого CSS-файла (32 МБ)
    private const BACKUP_DIR = 'backup/'; // Каталог для бэкапов предыдущих версий очищенных CSS-файлов
    private const SETTINGS_FILE = 'data/settings.json'; // Путь к JSON-файлу с пользовательскими настройками фильтрации
    private const MAX_INPUT_SIZE    = 16 * 1024 * 1024; // Максимальный размер JSON-пэйлоада (16 МБ)
    private const JSON_DECODE_DEPTH = 512; // Максимальная глубина вложенности при декодировании JSON

    private const CSS_MINIFY = true;           // минимизировать individual файлы
    private const CSS_COMBINED_MINIFY = true;  // минимизировать объединённый файл

    private const FIX_PATHS_INDIVIDUAL   = true;  // исправлять пути в отдельных очищенных файлах
    private const FIX_PATHS_COMBINED     = true;  // исправлять пути в объединённом файле
    
    private const INCLUDE_IMPORT_FILE_COMBINED = true; // включать @import файлы в объединённый файл

    private string $currentCharset = 'UTF-8'; // Текущая кодировка, используемая в CSS-файлах
    private array $importedFiles = []; // Для предотвращения циклических импортов

    // Paths and state
    private string $documentRoot;
    private string $baseDir;
    private array $errors = [];
    private array $processedFiles = [];
    private array $statistics = [];
    private array $settings = [
        'media'               => true,  // сохранять @media правила
        'media_print'         => true,  // сохранять @media print
        'keyframes'           => true,  // сохранять @keyframes анимации
        'font_face'           => true,  // сохранять @font-face шрифты
        'supports'            => true,  // сохранять @supports правила
        'page'                => true,  // сохранять @page правила
        'counter_style'       => true,  // сохранять @counter-style правила
        'layer'               => true,  // сохранять @layer правила
        'pseudo_classes'      => true,  // сохранять псевдо-классы (:hover, :focus)
        'pseudo_elements'     => true,  // сохранять псевдо-элементы (::before, ::after)
        'attribute_selectors' => true,  // сохранять селекторы по атрибутам ([attr=value])
        'css_variables'       => true,  // сохранять CSS-переменные (--var)
        'vendor_prefixes'     => true,  // сохранять префиксные свойства (-webkit-, -moz-)
        'adjacent_selectors'  => true,  // сохранять селекторы соседних элементов (E + F)
        'child_selectors'     => true,  // сохранять селекторы дочерних элементов (E > F)
        'general_siblings'    => true,  // сохранять общих соседей (E ~ F)
        'css_functions'       => true,  // сохранять функции (calc(), url(), rgb() и т.п.)
        'animations'          => true,  // сохранять свойства animation и transition
        'transforms'          => true,  // сохранять свойства transform
        'transitions'         => true,  // сохранять transition правила
        'percentages'         => true,  // сохранять значения в процентах (50%, 100%)
        'escapes'             => true,  // сохранять escape-последовательности (\\3020)
        'colors'              => true,  // сохранять цветовые функции (rgb(), hsl())
        'gradients'           => true,  // сохранять градиенты (linear-gradient, radial-gradient)
        'filters'             => true,  // сохранять CSS-фильтры (filter, backdrop-filter)
        'masks'               => true,  // сохранять маски и clip-path
        'nth_selectors'       => true,  // сохранять nth-child, nth-of-type
        'logical_selectors'   => true,  // сохранять логические селекторы (:not, :is, :where)
        'used_css_list'       => '', // список используемых селекторов, которые нужно сохранить
        'unused_css_list'     => '', // список неиспользуемых селекторов, которые нужно удалить
        'generation_mode'     => 'remove_unused', // 'remove_unused' или 'keep_used'
        'version'             => 1      // текущая версия конфигурации
    ];

    private array $criticalPatterns = [];
    private array $criticalSelectors = [
        'html',    // корневой элемент
        'body',    // основной контейнер документа
        '*',       // универсальный селектор
        ':root',   // корень документа для CSS-переменных
        'head',    // секция метаданных
        'title',   // заголовок страницы
        'meta',    // мета-теги
        'link',    // внешние ресурсы (CSS, favicon)
        'script',  // скрипты
        'style',   // встроенные стили
        'base'     // базовый URL
    ];

    private array $whitelistPatterns = []; // Обработанные паттерны белого списка
    private array $blacklistPatterns = []; // Обработанные паттерны черного списка


    public function __construct()
    {
        $this->documentRoot = $_SERVER['DOCUMENT_ROOT'] ?? '';
        $this->baseDir = dirname(__FILE__);
        $this->loadSettings();
    }

    private function loadSettings(): void
    {
        $settingsPath = $this->baseDir . '/' . self::SETTINGS_FILE;
        if (file_exists($settingsPath)) {
            $contents = file_get_contents($settingsPath);
            $decoded = json_decode($contents, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                $this->settings = array_merge($this->settings, $decoded);
            }
        }
        $this->updateCriticalPatterns();
    }

    private function saveSettings(array $settings): void
    {
        $settingsPath = $this->baseDir . '/' . self::SETTINGS_FILE;
        $this->ensureDirectoryExists(dirname($settingsPath));
        $settings['version'] = ($this->settings['version'] ?? 1) + 1;
        $this->settings = $settings;
        $json = json_encode($settings, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($json !== false) {
            file_put_contents($settingsPath, $json, LOCK_EX);
        }
    }

    private function clearOldData(): void
    {
        $selectorsPath = $this->baseDir . '/' . self::SELECTORS_FILE;
        if (file_exists($selectorsPath)) {
            unlink($selectorsPath);
        }
    }

    private function updateCriticalPatterns(): void
    {
        $this->criticalPatterns = [];
        
        // Существующие критические паттерны
        if ($this->settings['media']) $this->criticalPatterns[] = '/^@media/i';
        if ($this->settings['media_print']) $this->criticalPatterns[] = '/^@media\s+print/i';
        if ($this->settings['keyframes']) $this->criticalPatterns[] = '/^@keyframes/i';
        if ($this->settings['font_face']) $this->criticalPatterns[] = '/^@font-face/i';
        if ($this->settings['supports']) $this->criticalPatterns[] = '/^@supports/i';
        if ($this->settings['page']) $this->criticalPatterns[] = '/^@page/i';
        if ($this->settings['counter_style']) $this->criticalPatterns[] = '/^@counter-style/i';
        if ($this->settings['layer']) $this->criticalPatterns[] = '/^@layer/i';
        if ($this->settings['pseudo_classes']) $this->criticalPatterns[] = '/:[a-z-]+(?:\([^)]*\))?/i';
        if ($this->settings['pseudo_elements']) $this->criticalPatterns[] = '/::[a-z-]+/';
        if ($this->settings['attribute_selectors']) $this->criticalPatterns[] = '/\[[\w\-="\':\s]*\]/';
        if ($this->settings['css_variables']) $this->criticalPatterns[] = '/--[\w\-]+/';
        if ($this->settings['vendor_prefixes']) $this->criticalPatterns[] = '/-webkit-|-moz-|-ms-|-o-/';
        if ($this->settings['adjacent_selectors']) $this->criticalPatterns[] = '/\+/';
        if ($this->settings['child_selectors']) $this->criticalPatterns[] = '/>/';
        if ($this->settings['general_siblings']) $this->criticalPatterns[] = '/~/';
        if ($this->settings['css_functions']) $this->criticalPatterns[] = '/\(/';
        if ($this->settings['animations']) $this->criticalPatterns[] = '/animation|keyframes/i';
        if ($this->settings['transforms']) $this->criticalPatterns[] = '/transform/i';
        if ($this->settings['transitions']) $this->criticalPatterns[] = '/transition/i';
        if ($this->settings['percentages']) $this->criticalPatterns[] = '/\d+%/';
        if ($this->settings['escapes']) $this->criticalPatterns[] = '/\\\\/';
        if ($this->settings['colors']) $this->criticalPatterns[] = '/rgb\(|rgba\(|hsl\(|hsla\(/i';
        if ($this->settings['gradients']) $this->criticalPatterns[] = '/linear-gradient|radial-gradient/i';
        if ($this->settings['filters']) $this->criticalPatterns[] = '/filter|backdrop-filter/i';
        if ($this->settings['masks']) $this->criticalPatterns[] = '/mask|clip-path/i';
        if ($this->settings['nth_selectors']) $this->criticalPatterns[] = '/nth-child|nth-of-type/i';
        if ($this->settings['logical_selectors']) $this->criticalPatterns[] = '/not\(|is\(|where\(|has\(/i';
        
        // Обновление списков черного и белого списков
        $this->updateBlackWhiteLists();
    }

    /**
     * Обновляет паттерны черного и белого списков из настроек
     */
    private function updateBlackWhiteLists(): void
    {
        $this->whitelistPatterns = [];
        if (!empty($this->settings['used_css_list'])) {
            // Используем перенос строки как разделитель вместо запятой
            $whitelistItems = array_filter(
                array_map('trim', explode("\n", $this->settings['used_css_list'])),
                function($item) { return !empty($item); }
            );
            
            foreach ($whitelistItems as $item) {
                $normalizedPattern = $this->normalizePattern($item);
                if (!empty($normalizedPattern)) {
                    $this->whitelistPatterns[] = $this->convertWildcardToRegex($normalizedPattern);
                }
            }
        }
        
        $this->blacklistPatterns = [];
        if (!empty($this->settings['unused_css_list'])) {
            // Используем перенос строки как разделитель вместо запятой
            $blacklistItems = array_filter(
                array_map('trim', explode("\n", $this->settings['unused_css_list'])),
                function($item) { return !empty($item); }
            );
            
            foreach ($blacklistItems as $item) {
                $normalizedPattern = $this->normalizePattern($item);
                if (!empty($normalizedPattern)) {
                    $this->blacklistPatterns[] = $this->convertWildcardToRegex($normalizedPattern);
                }
            }
        }
    }

    /**
     * Преобразует wildcard паттерн в регулярное выражение
     * Поддерживает * как замену любого количества символов
     */
    private function convertWildcardToRegex(string $pattern): string
    {
        // Экранируем все спецсимволы regex, кроме * и ?
        $escaped = $this->escapeRegexSpecialChars($pattern);
        
        // Заменяем wildcard символы на соответствующие regex паттерны
        $regex = str_replace(
            ['\\*', '\\?'], // экранированные версии
            ['.*', '.'],    // regex эквиваленты
            $escaped
        );
        
        return '/^' . $regex . '$/i';
    }


    /**
     * МЕТОД: Нормализация паттерна - очистка и валидация
     */
    private function normalizePattern(string $pattern): string
    {
        // Убираем лишние пробелы
        $pattern = trim($pattern);
        
        // Игнорируем пустые строки и комментарии (начинающиеся с #)
        if (empty($pattern) || $pattern[0] === '#') {
            return '';
        }
        
        // Убираем множественные пробелы внутри паттерна
        $pattern = preg_replace('/\s+/', ' ', $pattern);
        
        return $pattern;
    }

    /**
     * МЕТОД: Экранирование спецсимволов regex (кроме wildcard)
     */
    private function escapeRegexSpecialChars(string $string): string
    {
        // Список всех спецсимволов regex
        $regexSpecialChars = [
            '\\', '^', '$', '.', '[', ']', '|', '(', ')', '+', '{', '}', '-'
        ];
        
        // Экранируем каждый спецсимвол, НО НЕ экранируем * и ?
        foreach ($regexSpecialChars as $char) {
            $string = str_replace($char, '\\' . $char, $string);
        }
        
        // Теперь экранируем * и ?, чтобы их можно было заменить позже
        $string = str_replace('*', '\\*', $string);
        $string = str_replace('?', '\\?', $string);
        
        return $string;
    }


    /**
     * Проверяет попадание селектора в черный или белый список
     * Возвращает: 'blacklist', 'whitelist' или null
     */
    private function checkBlackWhiteList(string $selector): ?string
    {
        // Проверка черного списка (приоритет выше)
        foreach ($this->blacklistPatterns as $pattern) {
            if (preg_match($pattern, $selector)) {
                return 'blacklist';
            }
        }
        
        // Проверка белого списка
        foreach ($this->whitelistPatterns as $pattern) {
            if (preg_match($pattern, $selector)) {
                return 'whitelist';
            }
        }
        
        return null;
    }

    public function processRequest(): void
    {
        try {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                $this->sendError(405, 'Method Not Allowed');
                return;
            }
            $requestData = $this->getInputData();
            if (!$requestData) {
                $this->sendError(400, 'Invalid JSON data');
                return;
            }
            $action = $_SERVER['HTTP_X_ACTION'] ?? ($_GET['action'] ?? 'save');
            if ($action === 'save') {
                $this->saveUnusedSelectors($requestData);
                $this->sendSuccess('Данные успешно сохранены');
            } elseif ($action === 'generate') {
                $this->generateCSSFiles($requestData);
                $this->sendSuccessWithStatistics('Файлы успешно сгенерированы');
            } elseif ($action === 'settings' || $action === 'saveSettings') {
                $this->handleSettings($requestData);
            } else {
                $this->sendError(400, 'Unknown action');
            }
        } catch (Exception $e) {
            $this->logError($e);
            $this->sendError(500, 'Internal Server Error: ' . $e->getMessage());
        }
    }

    private function handleSettings(array $requestData): void
    {
        if (isset($requestData['action']) && $requestData['action'] === 'save' && isset($requestData['settings'])) {
            $previousSettings = $this->settings;
            $this->saveSettings($requestData['settings']);
            
            $needReload = false;
            
            // Проверяем изменения в критических настройках
            $criticalSettings = [
                'media', 'media_print', 'keyframes', 'font_face', 'supports', 'page', 
                'counter_style', 'layer', 'pseudo_classes', 'pseudo_elements', 'attribute_selectors',
                'css_variables', 'vendor_prefixes', 'adjacent_selectors', 'child_selectors', 'general_siblings',
                'css_functions', 'animations', 'transforms', 'transitions', 'percentages', 'escapes', 'colors',
                'gradients', 'filters', 'masks', 'nth_selectors', 'logical_selectors'
            ];
            
            foreach ($criticalSettings as $key) {
                if (($previousSettings[$key] ?? true) !== ($requestData['settings'][$key] ?? true)) {
                    $needReload = true;
                    break;
                }
            }
            
            // Проверяем изменения в черном и белом списках
            if (($previousSettings['used_css_list'] ?? '') !== ($requestData['settings']['used_css_list'] ?? '') ||
                ($previousSettings['unused_css_list'] ?? '') !== ($requestData['settings']['unused_css_list'] ?? '')) {
                $needReload = true;
            }
            
            if ($needReload) {
                $this->clearOldData();
            }
            
            $this->sendSuccessWithData('Настройки сохранены', ['need_reload' => $needReload]);
        } elseif (isset($requestData['action']) && $requestData['action'] === 'load') {
            $this->sendSuccessWithData('Настройки загружены', ['settings' => $this->settings]);
        } else {
            $this->sendError(400, 'Invalid settings request');
        }
    }

    private function getInputData(): ?array
    {
        if (
            isset($_SERVER['CONTENT_LENGTH']) &&
            is_numeric($_SERVER['CONTENT_LENGTH']) &&
            (int)$_SERVER['CONTENT_LENGTH'] > self::MAX_INPUT_SIZE
        ) {
            throw new RuntimeException('Payload too large', 413);
        }

        $input = file_get_contents('php://input', false, null, 0, self::MAX_INPUT_SIZE + 1);
        if (!$input) return null;
        if (strlen($input) > self::MAX_INPUT_SIZE) {
            throw new RuntimeException('Payload too large', 413);
        }
        $data = json_decode($input, true, self::JSON_DECODE_DEPTH);
        if (json_last_error() !== JSON_ERROR_NONE) return null;
        return is_array($data) ? $data : null;
    }

    private function saveUnusedSelectors(array $selectorData): void
    {
        $masterSelectors = $this->loadMasterSelectors();
        $this->updateSelectorsUsage($masterSelectors, $selectorData);
        $this->saveMasterSelectors($masterSelectors);
        $this->processedFiles = array_keys($selectorData);
    }

    private function generateCSSFiles(array $selectorsPerFile): void
    {
        $masterSelectors = $this->loadMasterSelectors();
        $this->updateSelectorsUsage($masterSelectors, $selectorsPerFile);
        $this->saveMasterSelectors($masterSelectors);
        $this->createBackup($masterSelectors);
        $this->generateCleanCssFiles($masterSelectors);
    }

    private function loadMasterSelectors(): array
    {
        $selectorsPath = $this->baseDir . '/' . self::SELECTORS_FILE;
        if (file_exists($selectorsPath)) {
            $contents = file_get_contents($selectorsPath);
            $decoded = json_decode($contents, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($decoded)) {
                return $decoded;
            }
        }
        return [];
    }

    private function saveMasterSelectors(array $masterSelectors): void
    {
        // Очищаем мастер-список перед сохранением (оставляем только unused)
        $cleanedSelectors = $masterSelectors;
        $this->cleanupMasterSelectors($cleanedSelectors);
        
        $selectorsPath = $this->baseDir . '/' . self::SELECTORS_FILE;
        $this->ensureDirectoryExists(dirname($selectorsPath));
        
        $json = json_encode($cleanedSelectors, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            throw new RuntimeException('Не удалось сериализовать селекторы в JSON');
        }
        
        if (file_put_contents($selectorsPath, $json, LOCK_EX) === false) {
            throw new RuntimeException('Не удалось сохранить файл селекторов');
        }
    }

    private function updateSelectorsUsage(array &$masterSelectors, array $selectorsData): void
    {
        foreach ($selectorsData as $relativePath => $items) {
            $normalizedPath = $this->normalizeFilePath($relativePath);
            if ($normalizedPath === null) {
                continue;
            }
            
            if (!isset($masterSelectors[$normalizedPath])) {
                $masterSelectors[$normalizedPath] = [
                    'selectors' => [],
                    'keyframes' => [],
                    'font_faces' => [],
                    'counter_styles' => []
                ];
                $fullPath = $this->getFullFilePath($normalizedPath);
                if ($fullPath && file_exists($fullPath)) {
                    $this->initializeFileSelectors($fullPath, $masterSelectors[$normalizedPath]);
                }
            }
            
            foreach ($items as $item) {
                if (isset($item['selector'])) {
                    $selector = $item['selector'];
                    $used = $item['used'] ?? true;
                    if ($selector) {
                        $finalStatus = $this->determineFinalStatusWithAccumulation(
                            $selector, 
                            $used, 
                            'selector',
                            $masterSelectors[$normalizedPath]['selectors'][$selector] ?? 'unknown'
                        );
                        $masterSelectors[$normalizedPath]['selectors'][$selector] = $finalStatus;
                    }
                }
                elseif (isset($item['keyframes'])) {
                    $keyframeName = $item['keyframes'];
                    $used = $item['used'] ?? true;
                    if ($keyframeName) {
                        $finalStatus = $this->determineFinalStatusWithAccumulation(
                            $keyframeName, 
                            $used, 
                            'keyframes',
                            $masterSelectors[$normalizedPath]['keyframes'][$keyframeName] ?? 'unknown'
                        );
                        $masterSelectors[$normalizedPath]['keyframes'][$keyframeName] = $finalStatus;
                    }
                }
                elseif (isset($item['font-face'])) {
                    $fontName = $item['font-face'];
                    $used = $item['used'] ?? true;
                    if ($fontName) {
                        $finalStatus = $this->determineFinalStatusWithAccumulation(
                            $fontName, 
                            $used, 
                            'font-face',
                            $masterSelectors[$normalizedPath]['font_faces'][$fontName] ?? 'unknown'
                        );
                        $masterSelectors[$normalizedPath]['font_faces'][$fontName] = $finalStatus;
                    }
                }
                elseif (isset($item['counter-style'])) {
                    $counterName = $item['counter-style'];
                    $used = $item['used'] ?? true;
                    if ($counterName) {
                        $finalStatus = $this->determineFinalStatusWithAccumulation(
                            $counterName, 
                            $used, 
                            'counter-style',
                            $masterSelectors[$normalizedPath]['counter_styles'][$counterName] ?? 'unknown'
                        );
                        $masterSelectors[$normalizedPath]['counter_styles'][$counterName] = $finalStatus;
                    }
                }
            }
        }
    }

    /**
     * Определяет финальный статус элемента на основе приоритетов:
     * 1. Черный список -> unused
     * 2. Белый список -> used
     * 3. Критические фильтры -> used (если критический)
     * 4. Реальный статус использования
     */
    private function determineFinalStatus(string $element, bool $realUsed, string $type): string
    {
        // Приоритет 1: Черный список
        $listStatus = $this->checkBlackWhiteList($element);
        if ($listStatus === 'blacklist') {
            return 'unused';
        }
        
        // Приоритет 2: Белый список
        if ($listStatus === 'whitelist') {
            return 'used';
        }
        
        // Приоритет 3: Критические фильтры (только для селекторов)
        if ($type === 'selector' && !$this->isSelectorSafeToRemove($element)) {
            return 'used';
        }
        
        // Приоритет 4: Реальный статус использования
        return $realUsed ? 'used' : 'unused';
    }

    /**
     * Определяет финальный статус с учетом режима накопителя
     * Если селектор когда-либо был использован, статус остается 'used'
     */
    private function determineFinalStatusWithAccumulation(string $element, bool $realUsed, string $type, string $currentStatus): string
    {
        // Если уже помечен как используемый, остается используемым (режим накопителя)
        if ($currentStatus === 'used') {
            return 'used';
        }
        
        // Приоритет проверки: Черный список > Белый список > Критические настройки > Реальная проверка
        $listStatus = $this->checkBlackWhiteList($element);
        if ($listStatus === 'blacklist') {
            return 'unused';
        }
        if ($listStatus === 'whitelist') {
            return 'used';
        }
        
        // Проверка критических настроек (селекторы, которые нельзя удалять)
        if ($type === 'selector' && !$this->isSelectorSafeToRemove($element)) {
            return 'used';
        }
        
        // Реальная проверка использования
        return $realUsed ? 'used' : ($currentStatus === 'unknown' ? 'unused' : $currentStatus);
    }

    private function initializeFileSelectors(string $filePath, array &$fileData): void
    {
        try {
            $cssContent = file_get_contents($filePath);
            if ($cssContent === false) {
                throw new RuntimeException("Не удалось прочитать файл: {$filePath}");
            }
            $parser = new Parser($cssContent);
            $cssDocument = $parser->parse();
            $this->collectSelectorsFromDocument($cssDocument, $fileData);
        } catch (Exception $e) {
            $this->errors[] = "Ошибка инициализации селекторов для файла {$filePath}: " . $e->getMessage();
        }
    }

    private function collectSelectorsFromDocument($cssDocument, array &$fileData): void
    {
        foreach ($cssDocument->getContents() as $rule) {
            if ($rule instanceof DeclarationBlock) {
                $selectorObjects = $rule->getSelectors();
                foreach ($selectorObjects as $selectorObject) {
                    $selector = trim((string)$selectorObject);
                    if (!empty($selector)) {
                        if (!isset($fileData['selectors'][$selector])) {
                            // ИСПРАВЛЕНИЕ: Устанавливаем статус 'unknown' вместо 'used'
                            $fileData['selectors'][$selector] = 'unknown';
                        }
                    }
                }
            } elseif ($rule instanceof AtRuleBlockList) {
                $atRuleName = strtolower($rule->atRuleName());
                if ($atRuleName === 'keyframes' && $this->settings['keyframes']) {
                    $keyframeName = $this->extractAtRuleIdentifier($rule);
                    if ($keyframeName && !isset($fileData['keyframes'][$keyframeName])) {
                        $fileData['keyframes'][$keyframeName] = 'unknown';
                    }
                }
                elseif ($atRuleName === 'font-face' && $this->settings['font_face']) {
                    $fontName = $this->extractFontFaceName($rule);
                    if ($fontName && !isset($fileData['font_faces'][$fontName])) {
                        $fileData['font_faces'][$fontName] = 'unknown';
                    }
                }
                elseif ($atRuleName === 'counter-style' && $this->settings['counter_style']) {
                    $counterName = $this->extractAtRuleIdentifier($rule);
                    if ($counterName && !isset($fileData['counter_styles'][$counterName])) {
                        $fileData['counter_styles'][$counterName] = 'unknown';
                    }
                }
                $this->collectSelectorsFromDocument($rule, $fileData);
            } elseif ($rule instanceof AtRuleSet) {
                $atRuleName = strtolower($rule->atRuleName());
                if ($atRuleName === 'keyframes' && $this->settings['keyframes']) {
                    $keyframeName = $this->extractAtRuleIdentifier($rule);
                    if ($keyframeName && !isset($fileData['keyframes'][$keyframeName])) {
                        $fileData['keyframes'][$keyframeName] = 'unknown';
                    }
                }
                elseif ($atRuleName === 'font-face' && $this->settings['font_face']) {
                    $fontName = $this->extractFontFaceName($rule);
                    if ($fontName && !isset($fileData['font_faces'][$fontName])) {
                        $fileData['font_faces'][$fontName] = 'unknown';
                    }
                }
                elseif ($atRuleName === 'counter-style' && $this->settings['counter_style']) {
                    $counterName = $this->extractAtRuleIdentifier($rule);
                    if ($counterName && !isset($fileData['counter_styles'][$counterName])) {
                        $fileData['counter_styles'][$counterName] = 'unknown';
                    }
                }
            }
        }
    }

    private function extractAtRuleIdentifier($rule): ?string
    {
        if (method_exists($rule, 'getRule')) {
            $ruleValue = $rule->getRule();
            if ($ruleValue) {
                // Извлекаем имя из строки правила
                $ruleString = trim((string)$ruleValue);
                return $ruleString ?: null;
            }
        }
        return null;
    }

    private function extractFontFaceName($fontFaceRule): ?string
    {
        if (!method_exists($fontFaceRule, 'getContents')) {
            return null;
        }
        
        // Ищем font-family в декларациях @font-face
        foreach ($fontFaceRule->getContents() as $rule) {
            if ($rule instanceof DeclarationBlock) {
                foreach ($rule->getRules() as $declaration) {
                    if (strtolower($declaration->getRule()) === 'font-family') {
                        $value = $declaration->getValue();
                        if ($value instanceof CSSString) {
                            return $value->getString();
                        } elseif (is_string($value)) {
                            return trim($value, '\'"');
                        }
                    }
                }
            }
        }
        
        return null;
    }    

    /**
     * Нормализует входной путь, убирая query/fragment и ведущие слэши,
     * но не блокируя ../ — realpath развернёт их.
     */
    private function normalizeFilePath(string $path): ?string
    {
        $parsed = parse_url($path, PHP_URL_PATH) ?: $path;
        $rel    = ltrim(str_replace('\\', '/', $parsed), '/');

        // Собираем полный путь и сразу проверяем его валидность
        $full  = realpath($this->documentRoot . '/' . $rel);
        $root  = realpath($this->documentRoot);

        if (!$full || !$root) {
            // файл не существует или корень не определён
            return null;
        }
        if (strpos($full, $root) !== 0) {
            // попытка выйти за пределы корня
            return null;
        }

        // Отрезаем documentRoot, возвращаем относительный корректный путь
        return ltrim(substr($full, strlen($root)), DIRECTORY_SEPARATOR);
    }

    /**
     * По «чистому» относительному пути из normalizeFilePath
     * возвращает абсолютный путь или null.
     */
    private function getFullFilePath(string $relativePath): ?string
    {
        // Защита от бинарных payload’ов
        if (strpos($relativePath, "\0") !== false) {
            return null;
        }

        // realpath для окончательного разворачивания и проверки доступа
        $full      = realpath($this->documentRoot . '/' . $relativePath);
        $root      = realpath($this->documentRoot);

        if (!$full || !$root) {
            return null;
        }
        if (strpos($full, $root) !== 0) {
            return null;
        }
        if (!is_file($full) || !is_readable($full)) {
            return null;
        }

        return $full;
    }


    /**
     * Создаёт бэкап текущих CSS-файлов из подкаталога css/
     *
     * @param array $masterSelectors — master-селекторы (не используются внутри бэкапа, но сохраняются для
     *                   совместимости сигнатуры)
     */
    private function createBackup(array $masterSelectors): void
    {
        $timestamp = date('Y-m-d_H-i-s');
        $backupDir = $this->baseDir . '/' . self::BACKUP_DIR . $timestamp . '/';
        $this->ensureDirectoryExists($backupDir);

        $cssDir = $this->baseDir . '/' . self::CSS_DIR;
        if (!is_dir($cssDir)) {
            return;
        }

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($cssDir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );

        foreach ($iterator as $file) {
            /** @var \SplFileInfo $file */
            if ($file->isFile() && strtolower($file->getExtension()) === 'css') {
                $relative = substr($file->getPathname(), strlen($cssDir));
                $targetPath = $backupDir . self::CSS_DIR . $relative;
                $this->ensureDirectoryExists(dirname($targetPath));
                copy($file->getPathname(), $targetPath);
            }
        }

        $combined = $cssDir . self::COMBINED_FILE;
        if (file_exists($combined)) {
            copy($combined, $backupDir . self::CSS_DIR . self::COMBINED_FILE);
        }
    }


    private function generateCleanCssFiles(array $masterSelectors): void
    {
        $cssDir = $this->baseDir . '/' . self::CSS_DIR;
        $this->ensureDirectoryExists($cssDir);

        // Сброс списка импортированных файлов перед каждой генерацией
        $this->importedFiles = [];

        $combinedContent    = '';
        $importCharset      = '';
        $totalOriginalSize  = 0;
        $totalFinalSize     = 0;
        $totalRemovedSelectors = 0;
        $generatedFileCount = 0;

        foreach ($masterSelectors as $relativePath => $fileData) {
            try {
                $fullPath = $this->getFullFilePath($relativePath);
                if (!$fullPath || !file_exists($fullPath) || !is_readable($fullPath)) {
                    $this->errors[] = "Файл не найден или недоступен: {$relativePath}";
                    continue;
                }

                $totalOriginalSize += filesize($fullPath);

                // Обрабатываем файл как «отдельный» (не для объединения)
                $result = $this->processFile($fullPath, $fileData, true);
                if (!isset($result['cssDocument'])) {
                    continue;
                }

                $cssDocument = $result['cssDocument'];
                $cleanCssPath = $cssDir . $relativePath;
                $this->ensureDirectoryExists(dirname($cleanCssPath));

                // Рендерим минифицированный или красивый CSS
                $minifiedCss = self::CSS_MINIFY
                    ? $cssDocument->render(OutputFormat::createCompact())
                    : $cssDocument->render(OutputFormat::createPretty());

                if (file_put_contents($cleanCssPath, $minifiedCss) !== false) {
                    $this->processedFiles[]      = $relativePath;
                    $generatedFileCount++;
                    $totalFinalSize            += strlen($minifiedCss);
                    $totalRemovedSelectors     += ($result['removed_selectors'] ?? 0);
                    // Собираем charset, но НЕ удаляем import в отдельных файлах
                    $importCharset             .= ($result['import_charset'] ?? '');
                    $combinedContent           .= $minifiedCss . "\n\n";
                } else {
                    $this->errors[] = "Не удалось сохранить файл: {$cleanCssPath}";
                }
            } catch (Exception $e) {
                $this->errors[] = "Ошибка обработки файла {$relativePath}: " . $e->getMessage();
            }
        }

        // --- ПАТЧ: объединённый файл с развёртыванием локальных @import ---
        if (!empty($combinedContent)) {
            $combinedPath = $cssDir . self::COMBINED_FILE;

            // Извлечь и установить текущий charset из накопленного import_charset
            if (preg_match('/@charset\s+["\']([^"\']+)["\'];/i', $importCharset, $m)) {
                $this->currentCharset = strtoupper($m[1]);
            }

            $finalCombinedContent = $importCharset . $combinedContent;

            // Сбросим список, чтобы избежать циклов
            $this->importedFiles = [];

            // Заменяем локальные @import содержимым файлов
            $finalCombinedContent = $this->processImportsInCombined(
                $finalCombinedContent,
                $this->documentRoot
            );

            try {
                $parserCombined = new Parser($finalCombinedContent);
                $docCombined    = $parserCombined->parse();

                if (defined('self::FIX_PATHS_COMBINED') && self::FIX_PATHS_COMBINED) {
                    $this->fixPathsInCssDocument($docCombined, $this->documentRoot);
                }

                $finalCombinedContent = self::CSS_COMBINED_MINIFY
                    ? $docCombined->render(OutputFormat::createCompact())
                    : $docCombined->render(OutputFormat::createPretty());

            } catch (Exception $e) {
                $this->errors[] = "Не удалось обработать объединённый CSS: " . $e->getMessage();
            }

            if (file_put_contents($combinedPath, $finalCombinedContent) !== false) {
                $generatedFileCount++;
            } else {
                $this->errors[] = "Не удалось создать объединённый файл: {$combinedPath}";
            }

            $this->statistics['combined_size'] = strlen($finalCombinedContent);
        } else {
            $this->statistics['combined_size'] = 0;
        }

        // Финальные метрики
        $this->statistics = array_merge($this->statistics, [
            'processed_files'   => count($this->processedFiles),
            'generated_files'   => $generatedFileCount,
            'combined_file'     => !empty($combinedContent),
            'original_size'     => $totalOriginalSize,
            'final_size'        => $totalFinalSize,
            'bytes_saved'       => $totalOriginalSize - $totalFinalSize,
            'selectors_removed' => $totalRemovedSelectors,
        ]);
    }


    /**
     * Обрабатывает CSS-файл: парсит, удаляет неиспользуемые селекторы и исправляет пути.
     *
     * @param string $filePath Путь к CSS-файлу.
     * @param array  $selectors Массив селекторов для проверки использования.
     * @return array|null Массив с ключами 'cssDocument', 'removed_selectors', 'import_charset' или null.
     * @throws RuntimeException В случае ошибок чтения, размера файла или парсинга.
     */
    private function processFile(string $filePath, array $fileData, bool $isIndividualFile = true): ?array
    {
        $fileSize = filesize($filePath);
        if ($fileSize === false || $fileSize > self::MAX_FILE_SIZE) {
            throw new RuntimeException("Файл слишком большой или недоступен: {$filePath}");
        }

        $cssContent = file_get_contents($filePath);
        if ($cssContent === false) {
            throw new RuntimeException("Не удалось прочитать файл: {$filePath}");
        }

        try {
            $parser = new Parser($cssContent);
            $cssDocument = $parser->parse();

            if (self::FIX_PATHS_INDIVIDUAL) {
                $this->fixPathsInCssDocument($cssDocument, $filePath);
            }

            $importCharset = '';
            $removedSelectors = $this->removeUnusedRules($cssDocument, $fileData, $importCharset, $isIndividualFile);

            if (self::FIX_PATHS_INDIVIDUAL) {
                $originalDir = dirname($filePath);
                $documentRoot = realpath($this->documentRoot);
                $relativeDir = '';
                if ($documentRoot && strpos($originalDir, $documentRoot) === 0) {
                    $relativeDir = trim(substr($originalDir, strlen($documentRoot)), DIRECTORY_SEPARATOR);
                    if ($relativeDir !== '') {
                        $relativeDir = '/' . str_replace(DIRECTORY_SEPARATOR, '/', $relativeDir);
                    }
                }

                $renderedCSS = $cssDocument->render();
                $processedCSS = $this->postProcessCSSContent($renderedCSS, $relativeDir);
                if ($processedCSS !== $renderedCSS) {
                    $parser = new Parser($processedCSS);
                    $cssDocument = $parser->parse();
                }
            }

            return [
                'cssDocument' => $cssDocument,
                'removed_selectors'=> $removedSelectors,
                'import_charset' => $importCharset,
            ];
        } catch (Exception $e) {
            throw new RuntimeException("Ошибка парсинга CSS в файле {$filePath}: " . $e->getMessage());
        }
    }

    private function processImportsInCombined(string $cssContent, string $basePath = ''): string
    {
        if (!self::INCLUDE_IMPORT_FILE_COMBINED) {
            return $cssContent;
        }

        return preg_replace_callback(
            '/@import\s+(?:url\s*\(\s*)?["\']?([^"\')\s;]+)["\']?\s*\)?([^;]*);/i',
            function($matches) use ($basePath) {
                $url = trim($matches[1]);
                $media = trim($matches[2]);
                
                // Проверяем, является ли URL локальным
                if ($this->isLocalUrl($url)) {
                    $fullPath = $this->resolveImportPath($url, $basePath);
                    if ($fullPath && file_exists($fullPath) && !in_array($fullPath, $this->importedFiles)) {
                        $this->importedFiles[] = $fullPath;
                        
                        $importedContent = file_get_contents($fullPath);
                        if ($importedContent !== false) {
                            // Рекурсивно обрабатываем импорты во вставляемом файле
                            $importedContent = $this->processImportsInCombined($importedContent, dirname($fullPath));
                            
                            // Если есть медиа-условия, оборачиваем в @media
                            if (!empty($media)) {
                                $importedContent = "@media {$media} {\n{$importedContent}\n}";
                            }
                            
                            return $importedContent;
                        }
                    }
                }
                
                // Возвращаем оригинальный @import для внешних URL или ошибок
                return $matches[0];
            },
            $cssContent
        );
    }
   
    private function removeUnusedRules($cssDocument, array $fileData, string &$importCharset, bool $isIndividualFile = true): int
    {
        $contents = $cssDocument->getContents();
        $toRemove = [];
        $removedCount = 0;

        foreach ($contents as $rule) {
            if ($rule instanceof DeclarationBlock) {
                $result = $this->processDeclarationBlock($rule, $fileData['selectors'] ?? []);
                if ($result['remove']) {
                    $toRemove[] = $rule;
                    $removedCount += $result['count'];
                } elseif ($result['modified']) {
                    $removedCount += $result['count'];
                }
            } elseif ($rule instanceof AtRuleBlockList) {
                $atRuleType = strtolower($rule->atRuleName());
                
                // Обработка @charset и @import для отдельных файлов
                if ($isIndividualFile && in_array($atRuleType, ['charset', 'import'])) {
                    // Для отдельных файлов оставляем @import на месте
                    continue;
                }
                
                // Обработка @charset и @import для объединенного файла
                if (!$isIndividualFile && in_array($atRuleType, ['charset', 'import'])) {
                    $importCharset .= $rule->render() . "\n";
                    $toRemove[] = $rule;
                    continue;
                }

                if ($this->shouldRemoveAtRule($rule, $atRuleType, $fileData)) {
                    $toRemove[] = $rule;
                    $removedCount++;
                    continue;
                }

                if ($this->shouldPreserveAtRule($atRuleType)) {
                    continue;
                }

                if (in_array($atRuleType, ['supports', 'media', 'document', 'layer', 'container'])) {
                    $removedCount += $this->removeUnusedRules($rule, $fileData, $importCharset, $isIndividualFile);
                    if (empty($rule->getContents())) {
                        $toRemove[] = $rule;
                    }
                } elseif (!$this->isAtRuleAllowed($atRuleType)) {
                    $toRemove[] = $rule;
                }
            } elseif ($rule instanceof AtRuleSet) {
                $atRuleType = strtolower($rule->atRuleName());
                
                // Обработка @charset и @import для отдельных файлов
                if ($isIndividualFile && in_array($atRuleType, ['charset', 'import'])) {
                    // Для отдельных файлов оставляем @import на месте
                    continue;
                }
                
                // Обработка @charset и @import для объединенного файла
                if (!$isIndividualFile && in_array($atRuleType, ['charset', 'import'])) {
                    $importCharset .= $rule->render() . "\n";
                    $toRemove[] = $rule;
                    continue;
                }

                if ($this->shouldRemoveAtRule($rule, $atRuleType, $fileData)) {
                    $toRemove[] = $rule;
                    $removedCount++;
                    continue;
                }

                if (!$this->shouldPreserveAtRule($atRuleType) && !$this->isAtRuleAllowed($atRuleType)) {
                    $toRemove[] = $rule;
                }
            }
        }

        foreach ($toRemove as $rule) {
            $cssDocument->remove($rule);
        }

        return $removedCount;
    }

    private function shouldRemoveAtRule($rule, string $atRuleType, array $fileData): bool
    {
        $generationMode = $this->settings['generation_mode'] ?? 'remove_unused';
        
        if ($atRuleType === 'keyframes' && isset($fileData['keyframes'])) {
            $keyframeName = $this->extractAtRuleIdentifier($rule);
            if ($keyframeName && isset($fileData['keyframes'][$keyframeName])) {
                $status = $fileData['keyframes'][$keyframeName];
                return $this->shouldRemoveByStatus($status, $generationMode);
            }
        }
        
        if ($atRuleType === 'font-face' && isset($fileData['font_faces'])) {
            $fontName = $this->extractFontFaceName($rule);
            if ($fontName && isset($fileData['font_faces'][$fontName])) {
                $status = $fileData['font_faces'][$fontName];
                return $this->shouldRemoveByStatus($status, $generationMode);
            }
        }
        
        if ($atRuleType === 'counter-style' && isset($fileData['counter_styles'])) {
            $counterName = $this->extractAtRuleIdentifier($rule);
            if ($counterName && isset($fileData['counter_styles'][$counterName])) {
                $status = $fileData['counter_styles'][$counterName];
                return $this->shouldRemoveByStatus($status, $generationMode);
            }
        }
        
        return false;
    }

    /**
     * Определяет, следует ли удалить элемент в зависимости от его статуса и режима генерации
     */
    private function shouldRemoveByStatus(string $status, string $generationMode): bool
    {
        switch ($generationMode) {
            case 'keep_used':
                // В режиме "сохранить используемые" удаляем все, кроме явно используемых
                return $status !== 'used';
                
            case 'remove_unused':
            default:
                // В режиме "удалить неиспользуемые" удаляем только явно неиспользуемые
                return $status === 'unused';
        }
    }

    private function shouldPreserveAtRule(string $atRuleType): bool
    {
        $preserveMap = [
            'keyframes' => 'keyframes',
            'font-face' => 'font_face',
            'page' => 'page',
            'counter-style' => 'counter_style',
            'layer' => 'layer'
        ];
        return isset($preserveMap[$atRuleType]) && $this->settings[$preserveMap[$atRuleType]];
    }

    private function isAtRuleAllowed(string $atRuleType): bool
    {
        $allowedMap = [
            'media' => 'media',
            'supports' => 'supports'
        ];
        return isset($allowedMap[$atRuleType]) && $this->settings[$allowedMap[$atRuleType]];
    }

    private function processDeclarationBlock(DeclarationBlock $block, array $selectors): array
    {
        $selectorObjects = $block->getSelectors();
        $usedSelectors = [];
        $removedCount = 0;
        $generationMode = $this->settings['generation_mode'] ?? 'remove_unused';
        
        foreach ($selectorObjects as $selectorObj) {
            $selector = trim((string)$selectorObj);
            $status = isset($selectors[$selector]) ? $selectors[$selector] : 'unknown';
            
            $shouldKeep = $this->shouldKeepSelector($selector, $status, $generationMode);
            
            if ($shouldKeep) {
                $usedSelectors[] = $selectorObj;
            } else {
                $removedCount++;
            }
        }
        
        if (empty($usedSelectors)) {
            return ['remove' => true, 'count' => count($selectorObjects), 'modified' => false];
        }
        
        if (count($usedSelectors) < count($selectorObjects)) {
            $block->setSelectors($usedSelectors);
            return ['remove' => false, 'count' => $removedCount, 'modified' => true];
        }
        
        return ['remove' => false, 'count' => 0, 'modified' => false];
    }

    /**
     * Определяет, следует ли сохранить селектор в зависимости от режима генерации
     */
    private function shouldKeepSelector(string $selector, string $status, string $generationMode): bool
    {
        // Приоритет проверки: Черный список > Белый список > Критические настройки > Режим генерации
        
        $listStatus = $this->checkBlackWhiteList($selector);
        if ($listStatus === 'blacklist') {
            return false; // Принудительно удаляем
        }
        if ($listStatus === 'whitelist') {
            return true;  // Принудительно сохраняем
        }
        
        // Критические селекторы всегда сохраняются
        if (!$this->isSelectorSafeToRemove($selector)) {
            return true;
        }
        
        // Логика в зависимости от режима генерации
        switch ($generationMode) {
            case 'keep_used':
                // Сохраняем только явно используемые
                return $status === 'used';
                
            case 'remove_unused':
            default:
                // Удаляем только явно неиспользуемые
                return $status !== 'unused';
        }
    }

    private function cleanupMasterSelectors(array &$masterSelectors): void
    {
        $generationMode = $this->settings['generation_mode'] ?? 'remove_unused';
        
        foreach ($masterSelectors as $filePath => &$fileData) {
            if ($generationMode === 'keep_used') {
                // В режиме keep_used сохраняем только используемые для отображения
                $fileData['selectors'] = array_filter($fileData['selectors'], function($status) {
                    return $status === 'used';
                });
                $fileData['keyframes'] = array_filter($fileData['keyframes'], function($status) {
                    return $status === 'used';
                });
                $fileData['font_faces'] = array_filter($fileData['font_faces'], function($status) {
                    return $status === 'used';
                });
                $fileData['counter_styles'] = array_filter($fileData['counter_styles'], function($status) {
                    return $status === 'used';
                });
            } else {
                // В режиме remove_unused сохраняем только неиспользуемые для отображения
                $fileData['selectors'] = array_filter($fileData['selectors'], function($status) {
                    return $status === 'unused';
                });
                $fileData['keyframes'] = array_filter($fileData['keyframes'], function($status) {
                    return $status === 'unused';
                });
                $fileData['font_faces'] = array_filter($fileData['font_faces'], function($status) {
                    return $status === 'unused';
                });
                $fileData['counter_styles'] = array_filter($fileData['counter_styles'], function($status) {
                    return $status === 'unused';
                });
            }
        }
    }

    private function isSelectorSafeToRemove(string $selector): bool
    {
        if (empty($selector)) return false;
        
        $trimmed = trim($selector);
        
        // Проверка критических селекторов
        if (in_array(strtolower($trimmed), $this->criticalSelectors, true)) {
            return false;
        }
        
        // Проверка критических паттернов
        foreach ($this->criticalPatterns as $pattern) {
            if (preg_match($pattern, $trimmed)) {
                return false;
            }
        }
        
        return true;
    }

    private function ensureDirectoryExists(string $dir): void
    {
        if (!file_exists($dir)) {
            if (!mkdir($dir, 0755, true)) {
                throw new RuntimeException("Не удалось создать каталог: {$dir}");
            }
        }
    }

    /**
     * Исправляет пути в CSS документе, делая их абсолютными от корня сайта
     */
    private function fixPathsInCssDocument($cssDocument, string $originalFilePath): void
    {
        $originalDir = dirname($originalFilePath);
        $documentRoot = realpath($this->documentRoot);
        
        if (!$documentRoot) {
            return;
        }
        
        // Получаем относительный путь от корня сайта до директории CSS файла
        $relativeDirFromRoot = '';
        if (strpos($originalDir, $documentRoot) === 0) {
            $relativeDirFromRoot = trim(substr($originalDir, strlen($documentRoot)), DIRECTORY_SEPARATOR);
            if ($relativeDirFromRoot) {
                $relativeDirFromRoot = '/' . str_replace(DIRECTORY_SEPARATOR, '/', $relativeDirFromRoot);
            }
        }
        
        $this->processRulesForPaths($cssDocument, $relativeDirFromRoot);
    }

    /**
     * Рекурсивно обрабатывает все правила в CSS документе для исправления путей
     */
    private function processRulesForPaths($cssDocument, string $relativeDirFromRoot): void
    {
        foreach ($cssDocument->getContents() as $rule) {
            if ($rule instanceof DeclarationBlock) {
                $this->fixPathsInDeclarationBlock($rule, $relativeDirFromRoot);
            } elseif ($rule instanceof AtRuleBlockList) {
                $this->fixPathsInAtRule($rule, $relativeDirFromRoot);
                $this->processRulesForPaths($rule, $relativeDirFromRoot);
            } elseif ($rule instanceof AtRuleSet) {
                $this->fixPathsInAtRule($rule, $relativeDirFromRoot);
            }
        }
    }

    /**
     * Исправляет пути в блоке объявлений (обычные CSS правила)
     */
    private function fixPathsInDeclarationBlock(DeclarationBlock $block, string $relativeDirFromRoot): void
    {
        foreach ($block->getRules() as $rule) {
            $value = $rule->getValue();
            if ($value) {
                $newValue = $this->fixPathsInValue($value, $relativeDirFromRoot);
                if ($newValue !== $value) {
                    $rule->setValue($newValue);
                }
            }
        }
    }

    /**
     * Исправляет пути в at-правилах (@import, @font-face, @namespace и т.д.)
     */
    private function fixPathsInAtRule($atRule, string $relativeDirFromRoot): void
    {
        $atRuleType = strtolower($atRule->atRuleName());

        // Обработка правил @import и @namespace
        if (in_array($atRuleType, ['import', 'namespace'])) {
            if (method_exists($atRule, 'getRule')) {
                $rule = $atRule->getRule();
                if ($rule) {
                    $newRule = $this->fixPathsInValue($rule, $relativeDirFromRoot);
                    if ($newRule !== $rule && method_exists($atRule, 'setRule')) {
                        $atRule->setRule($newRule);
                    }
                }
            }
        }

        // Обработка содержимого блочных at-правил (только для AtRuleBlockList)
        if ($atRule instanceof AtRuleBlockList && method_exists($atRule, 'getContents')) {
            foreach ($atRule->getContents() as $rule) {
                if ($rule instanceof DeclarationBlock) {
                    $this->fixPathsInDeclarationBlock($rule, $relativeDirFromRoot);
                }
            }
        }
    }

    /**
     * Исправляет пути в значениях CSS свойств
     */
    private function fixPathsInValue($value, string $relativeDirFromRoot)
    {
        if ($value instanceof URL) {
            return $this->fixUrlValue($value, $relativeDirFromRoot);
        }
        
        if ($value instanceof CSSFunction) {
            return $this->fixPathsInFunction($value, $relativeDirFromRoot);
        }
        
        if ($value instanceof ValueList || $value instanceof RuleValueList) {
            return $this->fixPathsInValueList($value, $relativeDirFromRoot);
        }
        
        // Обработка строковых значений с URL
        if ($value instanceof CSSString) {
            $stringValue = $value->getString();
            // Проверяем, содержит ли строка url()
            if (preg_match('/url\s*\(\s*["\']?([^"\')\s]+)["\']?\s*\)/i', $stringValue, $matches)) {
                $url = $matches[1];
                $newUrl = $this->convertToAbsolutePath($url, $relativeDirFromRoot);
                if ($newUrl !== $url) {
                    $newStringValue = str_replace($matches[0], 'url("' . $newUrl . '")', $stringValue);
                    $value->setString($newStringValue);
                }
            }
        }
        
        // Обработка обычных строк (для @import и других случаев)
        if (is_string($value)) {
            // Обрабатываем строки с url()
            return preg_replace_callback('/url\s*\(\s*["\']?([^"\')\s]+)["\']?\s*\)/i', function($matches) use ($relativeDirFromRoot) {
                $url = $matches[1];
                $newUrl = $this->convertToAbsolutePath($url, $relativeDirFromRoot);
                return 'url("' . $newUrl . '")';
            }, $value);
        }
        
        return $value;
    }

    /**
     * Исправляет URL значения
     */
    private function fixUrlValue(URL $url, string $relativeDirFromRoot): URL
    {
        try {
            $urlValue = $url->getURL();
            
            if ($urlValue instanceof CSSString) {
                $path = $urlValue->getString();
                $newPath = $this->convertToAbsolutePath($path, $relativeDirFromRoot);
                if ($newPath !== $path) {
                    $urlValue->setString($newPath);
                }
            } elseif (is_string($urlValue)) {
                // Обработка случаев, когда URL возвращается как строка
                $newPath = $this->convertToAbsolutePath($urlValue, $relativeDirFromRoot);
                if ($newPath !== $urlValue) {
                    // Создаем новый CSSString объект
                    $url->setURL(new CSSString($newPath));
                }
            }
        } catch (Exception $e) {
            // Логируем ошибку, но не прерываем обработку
            $this->errors[] = "Ошибка обработки URL: " . $e->getMessage();
        }
        
        return $url;
    }

    /**
     * Исправляет пути в CSS функциях (image-set, cross-fade, paint и т.д.)
     */
    private function fixPathsInFunction(CSSFunction $function, string $relativeDirFromRoot): CSSFunction
    {
        $functionName = strtolower($function->getName());
        
        // Обрабатываем функции, которые могут содержать URL
        if (in_array($functionName, [
            'image-set', '-webkit-image-set', 'cross-fade', 'paint',
            'url', 'src', 'element'
        ])) {
            $arguments = $function->getArguments();
            $modified = false;
            
            foreach ($arguments as $i => $arg) {
                $newArg = $this->fixPathsInValue($arg, $relativeDirFromRoot);
                if ($newArg !== $arg) {
                    $arguments[$i] = $newArg;
                    $modified = true;
                }
            }
            
            if ($modified) {
                $function->setArguments($arguments);
            }
        }
        
        return $function;
    }

    /**
     * Исправляет пути в списках значений
     */
    private function fixPathsInValueList($valueList, string $relativeDirFromRoot)
    {
        $values = $valueList->getListComponents();
        $modified = false;
        
        foreach ($values as $i => $value) {
            $newValue = $this->fixPathsInValue($value, $relativeDirFromRoot);
            if ($newValue !== $value) {
                $values[$i] = $newValue;
                $modified = true;
            }
        }
        
        if ($modified) {
            $valueList->setListComponents($values);
        }
        
        return $valueList;
    }

    /**
     * Конвертирует относительный путь в абсолютный от корня сайта
     */
    private function convertToAbsolutePath(string $path, string $relativeDirFromRoot): string
    {
        // Удаляем кавычки если есть
        $cleanPath = trim($path, '"\'');
        
        // Пропускаем уже абсолютные пути и внешние ресурсы
        if (
            empty($cleanPath) ||
            $cleanPath[0] === '/' ||
            $cleanPath[0] === '#' ||
            strpos($cleanPath, 'http://') === 0 ||
            strpos($cleanPath, 'https://') === 0 ||
            strpos($cleanPath, '//') === 0 ||
            strpos($cleanPath, 'data:') === 0 ||
            strpos($cleanPath, 'blob:') === 0
        ) {
            return $path;
        }
        
        // Строим абсолютный путь от корня сайта
        if ($relativeDirFromRoot) {
            $absolutePath = $relativeDirFromRoot . '/' . $cleanPath;
        } else {
            $absolutePath = '/' . $cleanPath;
        }
        
        // Нормализуем путь (убираем ../  и ./)
        $absolutePath = $this->normalizePath($absolutePath);
        
        // Возвращаем с теми же кавычками, что были в оригинале
        if (strpos($path, '"') !== false) {
            return '"' . $absolutePath . '"';
        } elseif (strpos($path, "'") !== false) {
            return "'" . $absolutePath . "'";
        }
        
        return $absolutePath;
    }

    /**
     * Дополнительная обработка CSS содержимого через регулярные выражения
     * Вызывается после основной обработки парсером для захвата пропущенных URL
     */
    private function postProcessCSSContent(string $cssContent, string $relativeDirFromRoot): string
    {
        // Обрабатываем все url() в тексте CSS
        $cssContent = preg_replace_callback(
            '/url\s*\(\s*(["\']?)([^"\')\s]+)\1\s*\)/i',
            function($matches) use ($relativeDirFromRoot) {
                $quote = $matches[1];
                $url = $matches[2];
                $newUrl = $this->convertToAbsolutePath($url, $relativeDirFromRoot);
                return 'url(' . $quote . $newUrl . $quote . ')';
            },
            $cssContent
        );
        
        // Обрабатываем @import без url()
        $cssContent = preg_replace_callback(
            '/@import\s+(["\'])([^"\']+)\1/i',
            function($matches) use ($relativeDirFromRoot) {
                $quote = $matches[1];
                $url = $matches[2];
                $newUrl = $this->convertToAbsolutePath($url, $relativeDirFromRoot);
                return '@import ' . $quote . $newUrl . $quote;
            },
            $cssContent
        );
        
        return $cssContent;
    }


    /**
     * Нормализует путь, убирая ../ и ./
     */
    private function normalizePath(string $path): string
    {
        $parts = explode('/', $path);
        $normalized = [];
        
        foreach ($parts as $part) {
            if ($part === '' || $part === '.') {
                continue;
            }
            
            if ($part === '..') {
                if (!empty($normalized) && end($normalized) !== '..') {
                    array_pop($normalized);
                }
                continue;
            }
            
            $normalized[] = $part;
        }
        
        return '/' . implode('/', $normalized);
    }

    private function isLocalUrl(string $url): bool
    {
        return !preg_match('/^(https?:\/\/|\/\/|data:|blob:)/', $url);
    }

    private function resolveImportPath(string $url, string $basePath): ?string
    {
        // Убираем кавычки и лишние пробелы
        $cleanUrl = trim($url, '"\'');
        
        // Если путь абсолютный от корня сайта
        if ($cleanUrl[0] === '/') {
            $fullPath = $this->documentRoot . $cleanUrl;
        } else {
            // Относительный путь
            $fullPath = $basePath . '/' . $cleanUrl;
        }
        
        $realPath = realpath($fullPath);
        $documentRoot = realpath($this->documentRoot);
        
        // Проверяем безопасность пути
        if ($realPath && $documentRoot && strpos($realPath, $documentRoot) === 0) {
            return $realPath;
        }
        
        return null;
    }

    private function extractCharsetFromContent(string $content): ?string
    {
        if (preg_match('/@charset\s+["\']([^"\']+)["\'];/i', $content, $matches)) {
            return strtoupper($matches[1]);
        }
        return null;
    }

    private function convertEncoding(string $content, string $fromEncoding, string $toEncoding): string
    {
        if ($fromEncoding === $toEncoding) {
            return $content;
        }
        
        $converted = @iconv($fromEncoding, $toEncoding . '//IGNORE', $content);
        return $converted !== false ? $converted : $content;
    }

    private function sendSuccess(string $message): void
    {
        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        $response = [
            'success' => true,
            'message' => $message,
            'processed_files' => $this->processedFiles,
            'errors' => $this->errors
        ];
        echo json_encode($response, JSON_UNESCAPED_UNICODE);
    }

    private function sendSuccessWithData(string $message, array $data): void
    {
        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        $response = [
            'success' => true,
            'message' => $message,
            'data' => $data,
            'errors' => $this->errors
        ];
        echo json_encode($response, JSON_UNESCAPED_UNICODE);
    }

    private function sendSuccessWithStatistics(string $message): void
    {
        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        $response = [
            'success' => true,
            'message' => $message,
            'processed_files' => $this->processedFiles,
            'statistics' => $this->statistics,
            'errors' => $this->errors
        ];
        echo json_encode($response, JSON_UNESCAPED_UNICODE);
    }

    private function sendError(int $code, string $message): void
    {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
        $response = [
            'success' => false,
            'error' => $message,
            'errors' => $this->errors
        ];
        echo json_encode($response, JSON_UNESCAPED_UNICODE);
    }

    private function logError(Exception $e): void
    {
        $logMessage = sprintf(
            "[%s] %s in %s:%d\nStack trace:\n%s\n",
            date('Y-m-d H:i:s'),
            $e->getMessage(),
            $e->getFile(),
            $e->getLine(),
            $e->getTraceAsString()
        );
        error_log($logMessage, 3, $this->baseDir . '/error.log');
    }
}

// CORS
if (isset($_SERVER['HTTP_ORIGIN'])) {
    $allowedOrigins = [$_SERVER['HTTP_HOST'] ?? 'localhost'];
    $origin = $_SERVER['HTTP_ORIGIN'];
    $parsedOrigin = parse_url($origin);
    if (isset($parsedOrigin['host']) && in_array($parsedOrigin['host'], $allowedOrigins, true)) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, X-Action');
    }
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Определяем ОС и SAPI
$isWindows = PHP_OS_FAMILY === 'Windows';
$sapi = strtolower(PHP_SAPI);

$lockFp   = null;
$haveLock = false;

/**
 * Определяет, нужно ли использовать файловую блокировку вместо flock()
 * @return bool
 */
function needsFileLocking() {
    global $isWindows, $sapi;
    
    if (!$isWindows) {
        return false; // В Unix всегда используем flock
    }
    
    // В Windows проверяем проблемные SAPI
    $problematicSapi = [
        'isapi',           // ISAPI-расширение для IIS
        'apache2handler',  // mod_php под Windows (многопоточный MPM)
        'cli-server',      // встроенный веб-сервер (php -S)
        'embed',           // встроенный PHP
        'phpdbg'           // может быть проблематичен в некоторых случаях
    ];
    
    foreach ($problematicSapi as $problematic) {
        if (stripos($sapi, $problematic) !== false) {
            return true;
        }
    }
    
    // Дополнительная проверка для Apache под Windows
    if (stripos($sapi, 'apache') !== false && $isWindows) {
        return true;
    }
    
    return false;
}

try {
    $useFileLocking = needsFileLocking();
    
    if ($useFileLocking) {
        // === ФАЙЛОВАЯ БЛОКИРОВКА ===
        // Для ISAPI, Apache mod_php, встроенного сервера и других проблемных SAPI
        
        $maxWait   = 120;    // сек
        $start     = time();
        $delayUs   = 200000; // 0.2 секунды
        
        while (true) {
            // Атомарное создание файла
            $fp = @fopen(LOCK_FILE, 'x');
            if ($fp !== false) {
                // Захватили блокировку
                $lockData = [
                    'pid' => getmypid(),
                    'sapi' => PHP_SAPI,
                    'time' => time(),
                    'script' => $_SERVER['SCRIPT_NAME'] ?? 'unknown'
                ];
                fwrite($fp, json_encode($lockData) . "\n");
                fflush($fp);
                $lockFp   = $fp;
                $haveLock = true;
                break;
            }
            
            // Проверяем возраст существующего lock-файла
            clearstatcache(false, LOCK_FILE);
            if (file_exists(LOCK_FILE)) {
                $age = time() - @filemtime(LOCK_FILE);
                if ($age > $maxWait) {
                    // Старый lock-файл, удаляем его
                    @unlink(LOCK_FILE);
                    continue;
                }
            }
            
            // Проверяем таймаут ожидания
            if (time() - $start > $maxWait) {
                http_response_code(423); // Locked
                header('Content-Type: application/json; charset=utf-8');
                echo json_encode([
                    'success' => false,
                    'error'   => 'Не удалось получить блокировку: превышено время ожидания',
                    'timeout' => $maxWait,
                    'method'  => 'file_locking'
                ], JSON_UNESCAPED_UNICODE);
                exit;
            }
            
            usleep($delayUs);
        }
        
    } else {
        // === FLOCK БЛОКИРОВКА (блочная) ===
        // Для CLI, CGI, FastCGI, PHP-FPM и других SAPI с отдельными процессами
        
        // Открываем или создаём файл для блокировки
        $fp = @fopen(LOCK_FILE, 'c+');
        if ($fp === false) {
            throw new RuntimeException('Не удалось открыть lock-файл для flock');
        }
        $lockFp = $fp;
        
        // Блочно ждём, пока не получится эксклюзивно заблокировать файл
        if (!flock($lockFp, LOCK_EX)) {
            // flock вернёт false только в случае критической ошибки
            throw new RuntimeException('Критическая ошибка flock при попытке захвата блокировки');
        }
        
        $haveLock = true;
        
        // Записываем информацию о процессе в начало файла
        ftruncate($lockFp, 0);
        rewind($lockFp);
        $lockData = [
            'pid'    => getmypid(),
            'sapi'   => PHP_SAPI,
            'time'   => time(),
            'script' => $_SERVER['SCRIPT_NAME'] ?? 'unknown'
        ];
        fwrite($lockFp, json_encode($lockData) . "\n");
        fflush($lockFp);        
    }
   
    // === ОСНОВНОЙ КОД ЗАДАЧИ ===
    $processor = new RemoveUnusedCSSProcessor();
    $processor->processRequest();
    // ===========================
    
} catch (Throwable $e) {
    // В случае ошибки освобождаем блокировку
    if ($haveLock && isset($lockFp) && is_resource($lockFp)) {
        if ($useFileLocking) {
            fclose($lockFp);
            @unlink(LOCK_FILE);
        } else {
            flock($lockFp, LOCK_UN);
            fclose($lockFp);
        }
    }
    
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'error'   => 'Критическая ошибка при выполнении',
        'message' => $e->getMessage(),
        'sapi'    => PHP_SAPI
    ], JSON_UNESCAPED_UNICODE);
    
    exit;
    
} finally {
    // Освобождение блокировки в любом случае
    if ($haveLock && isset($lockFp) && is_resource($lockFp)) {
        if ($useFileLocking) {
            fclose($lockFp);
            @unlink(LOCK_FILE);
        } else {
            flock($lockFp, LOCK_UN);
            fclose($lockFp);
        }
    }
}

?>
