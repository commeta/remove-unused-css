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
    private const SELECTORS_FILE = 'data/unused_selectors.json'; // Путь к JSON-файлу, где хранятся все найденные неиспользуемые селекторы
    private const CSS_DIR = 'css/'; // Каталог, в который записываются очищенные (минимизированные) CSS-файлы
    private const COMBINED_FILE = 'remove-unused-css.min.css'; // Имя объединённого файла со всеми минимизированными стилями
    private const MAX_FILE_SIZE = 100 * 1024 * 1024; // Максимально допустимый размер обрабатываемого CSS-файла (100 МБ)
    private const BACKUP_DIR = 'backup/'; // Каталог для бэкапов предыдущих версий очищенных CSS-файлов
    private const SETTINGS_FILE = 'data/settings.json'; // Путь к JSON-файлу с пользовательскими настройками фильтрации
    private const MAX_INPUT_SIZE    = 15 * 1024 * 1024; // Максимальный размер JSON-пэйлоада (15 МБ)
    private const JSON_DECODE_DEPTH = 512; // Максимальная глубина вложенности при декодировании JSON

    private const CSS_MINIFY = true;           // минимизировать individual файлы
    private const CSS_COMBINED_MINIFY = true;  // минимизировать объединённый файл

    private const FIX_PATHS_INDIVIDUAL   = true;  // исправлять пути в отдельных очищенных файлах
    private const FIX_PATHS_COMBINED     = true;  // исправлять пути в объединённом файле
    
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
        'import'              => true,  // сохранять @import директивы
        'supports'            => true,  // сохранять @supports правила
        'page'                => true,  // сохранять @page правила
        'charset'             => true,  // сохранять @charset директиву
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
        if ($this->settings['media']) $this->criticalPatterns[] = '/^@media/i';
        if ($this->settings['media_print']) $this->criticalPatterns[] = '/^@media\s+print/i';
        if ($this->settings['keyframes']) $this->criticalPatterns[] = '/^@keyframes/i';
        if ($this->settings['font_face']) $this->criticalPatterns[] = '/^@font-face/i';
        if ($this->settings['import']) $this->criticalPatterns[] = '/^@import/i';
        if ($this->settings['supports']) $this->criticalPatterns[] = '/^@supports/i';
        if ($this->settings['page']) $this->criticalPatterns[] = '/^@page/i';
        if ($this->settings['charset']) $this->criticalPatterns[] = '/^@charset/i';
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
            foreach ([
                'media', 'media_print', 'keyframes', 'font_face', 'import', 'supports', 'page', 'charset',
                'counter_style', 'layer', 'pseudo_classes', 'pseudo_elements', 'attribute_selectors',
                'css_variables', 'vendor_prefixes', 'adjacent_selectors', 'child_selectors', 'general_siblings',
                'css_functions', 'animations', 'transforms', 'transitions', 'percentages', 'escapes', 'colors',
                'gradients', 'filters', 'masks', 'nth_selectors', 'logical_selectors'
            ] as $key) {
                if (($previousSettings[$key] ?? true) !== ($requestData['settings'][$key] ?? true)) {
                    $needReload = true;
                    break;
                }
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
        $selectorsPath = $this->baseDir . '/' . self::SELECTORS_FILE;
        $this->ensureDirectoryExists(dirname($selectorsPath));
        $json = json_encode($masterSelectors, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            throw new RuntimeException('Не удалось сериализовать селекторы в JSON');
        }
        if (file_put_contents($selectorsPath, $json, LOCK_EX) === false) {
            throw new RuntimeException('Не удалось сохранить файл селекторов');
        }
    }

    private function updateSelectorsUsage(array &$masterSelectors, array $selectorsData): void
    {
        foreach ($selectorsData as $relativePath => $selectors) {
            $normalizedPath = $this->normalizeFilePath($relativePath);
            if ($normalizedPath === null) {
                continue;
            }

            if (!isset($masterSelectors[$normalizedPath])) {
                $masterSelectors[$normalizedPath] = [];
                $fullPath = $this->getFullFilePath($normalizedPath);
                if ($fullPath && file_exists($fullPath)) {
                    $this->initializeFileSelectors($fullPath, $masterSelectors[$normalizedPath]);
                }
            }
            foreach ($selectors as $selectorInfo) {
                $selector = $selectorInfo['selector'] ?? '';
                if ($selector && isset($masterSelectors[$normalizedPath][$selector])) {
                    $masterSelectors[$normalizedPath][$selector] = 'used';
                }
            }
        }
    }

    private function initializeFileSelectors(string $filePath, array &$selectors): void
    {
        try {
            $cssContent = file_get_contents($filePath);
            if ($cssContent === false) {
                throw new RuntimeException("Не удалось прочитать файл: {$filePath}");
            }
            $parser = new Parser($cssContent);
            $cssDocument = $parser->parse();
            $this->collectSelectorsFromDocument($cssDocument, $selectors);
        } catch (Exception $e) {
            $this->errors[] = "Ошибка инициализации селекторов для файла {$filePath}: " . $e->getMessage();
        }
    }

    private function collectSelectorsFromDocument($cssDocument, array &$selectors): void
    {
        foreach ($cssDocument->getContents() as $rule) {
            if ($rule instanceof DeclarationBlock) {
                $selectorObjects = $rule->getSelectors();
                foreach ($selectorObjects as $selectorObject) {
                    $selector = trim((string)$selectorObject);
                    if (!empty($selector)) {
                        $selectors[$selector] = $this->isSelectorSafeToRemove($selector) ? 'unused' : 'used';
                    }
                }
            } elseif ($rule instanceof AtRuleBlockList || $rule instanceof AtRuleSet) {
                // Рекурсивно обрабатываем at-правила, которые могут содержать селекторы
                if (method_exists($rule, 'getContents')) {
                    $this->collectSelectorsFromDocument($rule, $selectors);
                }
            }
        }
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

        $combinedContent        = '';
        $importCharset          = '';
        $totalOriginalSize      = 0;
        $totalFinalSize         = 0;
        $totalRemovedSelectors  = 0;
        $generatedFileCount     = 0;

        foreach ($masterSelectors as $relativePath => $selectors) {
            try {
                $fullPath = $this->getFullFilePath($relativePath);
                if (!$fullPath || !file_exists($fullPath) || !is_readable($fullPath)) {
                    $this->errors[] = "Файл не найден или недоступен: {$relativePath}";
                    continue;
                }

                $originalSize = filesize($fullPath);
                $totalOriginalSize += $originalSize;

                $result = $this->processFile($fullPath, $selectors);
                if (!isset($result['cssDocument'])) {
                    continue;
                }

                $cssDocument   = $result['cssDocument'];
                $cleanCssPath  = $cssDir . $relativePath;
                $this->ensureDirectoryExists(dirname($cleanCssPath));

                // Рендерим/минифицируем каждый файл отдельно
                if (self::CSS_MINIFY) {
                    $minifiedCss = $cssDocument->render(OutputFormat::createCompact());
                } else {
                    $minifiedCss = $cssDocument->render(OutputFormat::createPretty());
                }

                if (file_put_contents($cleanCssPath, $minifiedCss) !== false) {
                    $this->processedFiles[]     = $relativePath;
                    $generatedFileCount++;
                    $finalSize         = strlen($minifiedCss);
                    $totalFinalSize   += $finalSize;
                    $totalRemovedSelectors += $result['removed_selectors'] ?? 0;
                    $importCharset   .= $result['import_charset'] ?? '';
                    $combinedContent .= $minifiedCss . "\n\n";
                } else {
                    $this->errors[] = "Не удалось сохранить файл: {$cleanCssPath}";
                }

            } catch (Exception $e) {
                $this->errors[] = "Ошибка обработки файла {$relativePath}: " . $e->getMessage();
            }
        }

        // Блок объединённого CSS с исправлением путей и опциональной минификацией
        if (!empty($combinedContent)) {
            $combinedPath          = $cssDir . self::COMBINED_FILE;
            $finalCombinedContent  = $importCharset . $combinedContent;

            try {
                $parserCombined = new Parser($finalCombinedContent);
                $docCombined    = $parserCombined->parse();

                // Исправляем пути в объединённом файле, если включена настройка
                if (defined('self::FIX_PATHS_COMBINED') && self::FIX_PATHS_COMBINED) {
                    $this->fixPathsInCssDocument($docCombined, $this->documentRoot);
                }

                if (self::CSS_COMBINED_MINIFY) {
                    $finalCombinedContent = $docCombined->render(OutputFormat::createCompact());
                } else {
                    $finalCombinedContent = $docCombined->render(OutputFormat::createPretty());
                }

            } catch (Exception $e) {
                $this->errors[] = "Не удалось обработать объединённый CSS: " . $e->getMessage();
            }

            $combinedSize = strlen($finalCombinedContent);
            if (file_put_contents($combinedPath, $finalCombinedContent) !== false) {
                $generatedFileCount++;
            } else {
                $this->errors[] = "Не удалось создать объединённый файл: {$combinedPath}";
            }

            $this->statistics['combined_size'] = $combinedSize;
        } else {
            $this->statistics['combined_size'] = 0;
        }

        // Итоговые статистики
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
    private function processFile(string $filePath, array $selectors): ?array
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
            // Первый парсинг содержимого
            $parser = new Parser($cssContent);
            $cssDocument = $parser->parse();

            // 1) Исправляем пути (Parser‑based)
            if (self::FIX_PATHS_INDIVIDUAL) {
                $this->fixPathsInCssDocument($cssDocument, $filePath);
            }

            // 2) Удаляем неиспользуемые селекторы
            $importCharset = '';
            $removedSelectors = $this->removeUnusedRules($cssDocument, $selectors, $importCharset);

            // 3) Дополнительная пост‑обработка через регулярки
            if (self::FIX_PATHS_INDIVIDUAL) {
                $originalDir   = dirname($filePath);
                $documentRoot  = realpath($this->documentRoot);
                $relativeDir   = '';

                if ($documentRoot && strpos($originalDir, $documentRoot) === 0) {
                    $relativeDir = trim(substr($originalDir, strlen($documentRoot)), DIRECTORY_SEPARATOR);
                    if ($relativeDir !== '') {
                        $relativeDir = '/' . str_replace(DIRECTORY_SEPARATOR, '/', $relativeDir);
                    }
                }

                // Рендерим CSS, применяем regexp‑патчи и при изменении повторно парсим
                $renderedCSS = $cssDocument->render();
                $processedCSS = $this->postProcessCSSContent($renderedCSS, $relativeDir);

                if ($processedCSS !== $renderedCSS) {
                    $parser     = new Parser($processedCSS);
                    $cssDocument = $parser->parse();
                }
            }

            return [
                'cssDocument'      => $cssDocument,
                'removed_selectors'=> $removedSelectors,
                'import_charset'   => $importCharset,
            ];
        } catch (Exception $e) {
            throw new RuntimeException("Ошибка парсинга CSS в файле {$filePath}: " . $e->getMessage());
        }
    }


    private function removeUnusedRules($cssDocument, array $selectors, string &$importCharset): int
    {
        $contents = $cssDocument->getContents();
        $toRemove = [];
        $removedCount = 0;
        
        foreach ($contents as $rule) {
            if ($rule instanceof DeclarationBlock) {
                $result = $this->processDeclarationBlock($rule, $selectors);
                if ($result['remove']) {
                    $toRemove[] = $rule;
                    $removedCount += $result['count'];
                } elseif ($result['modified']) {
                    $removedCount += $result['count'];
                }
            } elseif ($rule instanceof AtRuleBlockList || $rule instanceof AtRuleSet) {
                $atRuleType = strtolower($rule->atRuleName());
                
                if (in_array($atRuleType, ['charset', 'import'])) {
                    $importCharset .= $rule->render() . "\n";
                    $toRemove[] = $rule;
                    continue;
                }
                
                if ($this->shouldPreserveAtRule($atRuleType)) {
                    continue;
                }
                
                if (in_array($atRuleType, ['supports', 'media', 'document', 'layer', 'container'])) {
                    $removedCount += $this->removeUnusedRules($rule, $selectors, $importCharset);
                    if (empty($rule->getContents())) {
                        $toRemove[] = $rule;
                    }
                } elseif (!$this->isAtRuleAllowed($atRuleType)) {
                    $toRemove[] = $rule;
                }
            }
        }
        
        foreach ($toRemove as $rule) {
            $cssDocument->remove($rule);
        }
        
        return $removedCount;
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
        foreach ($selectorObjects as $selectorObj) {
            $selector = trim((string)$selectorObj);
            if ($this->isSelectorSafeToRemove($selector) && (!isset($selectors[$selector]) || $selectors[$selector] === 'unused')) {
                $removedCount++;
                continue;
            }
            $usedSelectors[] = $selectorObj;
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

    private function isSelectorSafeToRemove(string $selector): bool
    {
        if (empty($selector)) return false;
        $trimmed = trim($selector);
        if (in_array(strtolower($trimmed), $this->criticalSelectors, true)) {
            return false;
        }
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
            } elseif ($rule instanceof AtRuleBlockList || $rule instanceof AtRuleSet) {
                $this->fixPathsInAtRule($rule, $relativeDirFromRoot);
                // Рекурсивно обрабатываем содержимое at-правил
                if (method_exists($rule, 'getContents')) {
                    $this->processRulesForPaths($rule, $relativeDirFromRoot);
                }
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
        
        // Обработка @import
        if ($atRuleType === 'import') {
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
        
        // Обработка @namespace
        if ($atRuleType === 'namespace') {
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
        
        // Обработка @font-face и других at-правил с содержимым
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
