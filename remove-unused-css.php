<?php
/*
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2025 Commeta
 * Released under the GPL v3 or MIT license
 */

declare(strict_types=1);

// Подключаем autoload для sabberworm/php-css-parser
if (!file_exists(__DIR__ . '/vendor/autoload.php')) {
    http_response_code(500);
    die('Composer dependencies not installed. Run: composer install');
}

require_once __DIR__ . '/vendor/autoload.php';

use Sabberworm\CSS\Parser;
use Sabberworm\CSS\CSSList\Document;
use Sabberworm\CSS\RuleSet\DeclarationBlock;
use Sabberworm\CSS\CSSList\AtRuleBlock;
use Sabberworm\CSS\Property\AtRule;

/**
 * Главный класс для обработки неиспользуемых CSS-селекторов
 */
class RemoveUnusedCSSProcessor
{
    // Константы конфигурации
    private const SELECTORS_FILE = 'data/unused_selectors.json';
    private const CLEAN_CSS_DIR = 'css/';
    private const COMBINED_CSS_FILE = 'remove-unused-css.min.css';
    private const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    
    private string $documentRoot;
    private string $baseDir;
    private array $errors = [];
    private array $processedFiles = [];
    private array $statistics = [];

    public function __construct()
    {
        $this->documentRoot = $_SERVER['DOCUMENT_ROOT'] ?? '';
        $this->baseDir = dirname(__FILE__);
    }

    /**
     * Основная точка входа для обработки запроса
     */
    public function processRequest(): void
    {
        try {
            // Проверяем метод запроса
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                $this->sendError(405, 'Method Not Allowed');
                return;
            }

            // Получаем и валидируем данные
            $data = $this->getInputData();
            if (!$data) {
                $this->sendError(400, 'Invalid JSON data');
                return;
            }

            // Определяем действие
            $action = $_SERVER['HTTP_X_ACTION'] ?? 'save';
            
            if ($action === 'save') {
                $this->saveUnusedSelectors($data);
                $this->sendSuccess('Данные успешно сохранены');
            } elseif ($action === 'generate') {
                $this->generateCSSFiles($data);
                $this->sendSuccessWithStatistics('Файлы успешно сгенерированы');
            } else {
                $this->sendError(400, 'Unknown action');
            }
            
        } catch (Exception $e) {
            $this->logError($e);
            $this->sendError(500, 'Internal Server Error: ' . $e->getMessage());
        }
    }

    /**
     * Получает и валидирует входные данные
     */
    private function getInputData(): ?array
    {
        $input = file_get_contents('php://input');
        if (!$input) {
            return null;
        }

        $data = json_decode($input, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return null;
        }

        return is_array($data) ? $data : null;
    }

    /**
     * Сохраняет неиспользуемые селекторы (только сохранение данных)
     */
    private function saveUnusedSelectors(array $data): void
    {
        // Загружаем существующие данные
        $masterSelectors = $this->loadMasterSelectors();
        
        // Обновляем статус селекторов с текущей страницы
        $this->updateSelectorsUsage($masterSelectors, $data);
        
        // Сохраняем обновленные селекторы
        $this->saveMasterSelectors($masterSelectors);
        
        // Добавляем в обработанные файлы только те, что пришли от клиента
        $this->processedFiles = array_keys($data);
    }

    /**
     * Генерирует CSS файлы на основе сохраненных данных
     */
    private function generateCSSFiles(array $currentPageData): void
    {
        // Загружаем мастер-селекторы (накопленные со всех страниц)
        $masterSelectors = $this->loadMasterSelectors();
        
        // Обновляем статус селекторов с текущей страницы
        $this->updateSelectorsUsage($masterSelectors, $currentPageData);
        
        // Сохраняем обновленные селекторы
        $this->saveMasterSelectors($masterSelectors);
        
        // Генерируем очищенные CSS файлы
        $this->generateCleanCssFiles($masterSelectors);
    }

    /**
     * Загружает мастер-селекторы из файла или создает новые
     */
    private function loadMasterSelectors(): array
    {
        $selectorsFile = $this->baseDir . '/' . self::SELECTORS_FILE;
        
        if (file_exists($selectorsFile)) {
            $content = file_get_contents($selectorsFile);
            $selectors = json_decode($content, true);
            
            if (json_last_error() === JSON_ERROR_NONE && is_array($selectors)) {
                return $selectors;
            }
        }
        
        // Возвращаем пустой массив, селекторы будут добавляться по мере использования
        return [];
    }

    /**
     * Сохраняет мастер-селекторы в файл
     */
    private function saveMasterSelectors(array $masterSelectors): void
    {
        $selectorsFile = $this->baseDir . '/' . self::SELECTORS_FILE;
        $this->ensureDirectoryExists(dirname($selectorsFile));
        
        $json = json_encode($masterSelectors, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            throw new RuntimeException('Не удалось сериализовать селекторы в JSON');
        }
        
        if (file_put_contents($selectorsFile, $json, LOCK_EX) === false) {
            throw new RuntimeException('Не удалось сохранить файл селекторов');
        }
    }

    /**
     * Обновляет статус селекторов на основе данных от клиента
     */
    private function updateSelectorsUsage(array &$masterSelectors, array $data): void
    {
        foreach ($data as $href => $selectors) {
            $relativePath = $this->normalizeFilePath($href);
            
            // Инициализируем массив для файла, если его нет
            if (!isset($masterSelectors[$relativePath])) {
                $masterSelectors[$relativePath] = [];
                
                // Парсим файл для получения всех селекторов
                $filePath = $this->getFullFilePath($relativePath);
                if ($filePath && file_exists($filePath)) {
                    $this->initializeFileSelectors($filePath, $masterSelectors[$relativePath]);
                }
            }
            
            // Отмечаем неиспользуемые селекторы
            $unusedSelectors = array_column($selectors, 'selector');
            
            foreach ($masterSelectors[$relativePath] as $selector => &$status) {
                if (in_array($selector, $unusedSelectors, true)) {
                    // Селектор неиспользуемый на этой странице
                    if (!isset($status)) {
                        $status = 'unused';
                    }
                } else {
                    // Селектор используется на этой странице
                    $status = 'used';
                }
            }
            unset($status); // Разрываем ссылку
        }
    }

    /**
     * Инициализирует селекторы для файла
     */
    private function initializeFileSelectors(string $filePath, array &$selectors): void
    {
        try {
            $cssContent = file_get_contents($filePath);
            if ($cssContent === false) {
                throw new RuntimeException("Не удалось прочитать файл: {$filePath}");
            }
            
            $parser = new Parser($cssContent);
            $cssDoc = $parser->parse();
            
            $this->collectSelectorsFromDocument($cssDoc, $selectors);
            
        } catch (Exception $e) {
            $this->errors[] = "Ошибка инициализации селекторов для файла {$filePath}: " . $e->getMessage();
        }
    }

    /**
     * Собирает селекторы из CSS-документа
     */
    private function collectSelectorsFromDocument($cssContainer, array &$selectors): void
    {
        foreach ($cssContainer->getContents() as $rule) {
            if ($rule instanceof DeclarationBlock) {
                $selectorObjects = $rule->getSelectors();
                
                foreach ($selectorObjects as $selectorObj) {
                    $selector = trim((string)$selectorObj);
                    if (!empty($selector) && !isset($selectors[$selector])) {
                        $selectors[$selector] = 'unused'; // По умолчанию неиспользуемый
                    }
                }
            } elseif ($rule instanceof AtRuleBlock) {
                $this->collectSelectorsFromDocument($rule, $selectors);
            }
        }
    }

    /**
     * Нормализует путь к файлу
     */
    private function normalizeFilePath(string $path): string
    {
        // Убираем возможные query параметры и якоря
        $path = parse_url($path, PHP_URL_PATH) ?: $path;
        
        // Убираем ведущий слеш
        return ltrim($path, '/');
    }

    /**
     * Получает полный путь к файлу
     */
    private function getFullFilePath(string $relativePath): ?string
    {
        if ($relativePath === 'inline') {
            return null; // Inline стили не обрабатываем
        }
        
        $fullPath = $this->documentRoot . '/' . $relativePath;
        
        // Проверяем безопасность пути (защита от path traversal)
        $realPath = realpath($fullPath);
        $realDocRoot = realpath($this->documentRoot);
        
        if ($realPath && $realDocRoot && strpos($realPath, $realDocRoot) === 0) {
            return $realPath;
        }
        
        return null;
    }

    /**
     * Генерирует очищенные CSS-файлы
     */
    private function generateCleanCssFiles(array $masterSelectors): void
    {
        $cleanCssDir = $this->baseDir . '/' . self::CLEAN_CSS_DIR;
        $this->ensureDirectoryExists($cleanCssDir);
        
        $combinedCss = '';
        $totalOriginalSize = 0;
        $totalFinalSize = 0;
        $totalSelectorsRemoved = 0;
        $generatedFiles = 0;
        
        foreach ($masterSelectors as $relativePath => $selectors) {
            if ($relativePath === 'inline') {
                continue; // Пропускаем inline стили
            }
            
            try {
                $filePath = $this->getFullFilePath($relativePath);
                
                if (!$filePath || !file_exists($filePath) || !is_readable($filePath)) {
                    $this->errors[] = "Файл не найден или недоступен: {$relativePath}";
                    continue;
                }
                
                $originalSize = filesize($filePath);
                $totalOriginalSize += $originalSize;
                
                $result = $this->processFile($filePath, $selectors);
                
                if ($result && !empty($result['css'])) {
                    // Сохраняем отдельный файл
                    $cleanCssPath = $cleanCssDir . $relativePath;
                    $this->ensureDirectoryExists(dirname($cleanCssPath));
                    
                    if (file_put_contents($cleanCssPath, $result['css']) !== false) {
                        $this->processedFiles[] = $relativePath;
                        $generatedFiles++;
                        
                        $finalSize = strlen($result['css']);
                        $totalFinalSize += $finalSize;
                        $totalSelectorsRemoved += $result['removed_selectors'];
                        
                        // Добавляем к объединенному файлу
                        $combinedCss .= "/* {$relativePath} */\n" . $result['css'] . "\n\n";
                    } else {
                        $this->errors[] = "Не удалось сохранить файл: {$cleanCssPath}";
                    }
                }
                
            } catch (Exception $e) {
                $this->errors[] = "Ошибка обработки файла {$relativePath}: " . $e->getMessage();
            }
        }
        
        // Создаем объединенный минимизированный файл
        $combinedSize = 0;
        if (!empty($combinedCss)) {
            $combinedPath = $cleanCssDir . self::COMBINED_CSS_FILE;
            $minifiedCss = $this->minifyCss($combinedCss);
            $combinedSize = strlen($minifiedCss);
            
            if (file_put_contents($combinedPath, $minifiedCss) !== false) {
                $generatedFiles++;
            } else {
                $this->errors[] = "Не удалось создать объединенный файл: {$combinedPath}";
            }
        }
        
        // Сохраняем статистику
        $this->statistics = [
            'processed_files' => count($this->processedFiles),
            'generated_files' => $generatedFiles,
            'combined_file' => !empty($combinedCss),
            'original_size' => $totalOriginalSize,
            'final_size' => $totalFinalSize,
            'combined_size' => $combinedSize,
            'bytes_saved' => $totalOriginalSize - $totalFinalSize,
            'selectors_removed' => $totalSelectorsRemoved
        ];
    }

    /**
     * Обрабатывает отдельный CSS файл
     */
    private function processFile(string $filePath, array $selectorsStatus): ?array
    {
        $fileSize = filesize($filePath);
        if ($fileSize > self::MAX_FILE_SIZE) {
            throw new RuntimeException("Файл слишком большой: {$filePath}");
        }
        
        $cssContent = file_get_contents($filePath);
        if ($cssContent === false) {
            throw new RuntimeException("Не удалось прочитать файл: {$filePath}");
        }
        
        try {
            $parser = new Parser($cssContent);
            $cssDoc = $parser->parse();
            
            $removedSelectors = $this->removeUnusedRules($cssDoc, $selectorsStatus);
            
            return [
                'css' => $cssDoc->render(),
                'removed_selectors' => $removedSelectors
            ];
            
        } catch (Exception $e) {
            throw new RuntimeException("Ошибка парсинга CSS в файле {$filePath}: " . $e->getMessage());
        }
    }

    /**
     * Рекурсивно удаляет неиспользуемые правила из CSS-документа
     */
    private function removeUnusedRules($cssContainer, array $selectorsStatus): int
    {
        $contents = $cssContainer->getContents();
        $toRemove = [];
        $removedCount = 0;
        
        foreach ($contents as $rule) {
            if ($rule instanceof DeclarationBlock) {
                if ($this->isRuleUnused($rule, $selectorsStatus)) {
                    $toRemove[] = $rule;
                    $removedCount += count($rule->getSelectors());
                }
            } elseif ($rule instanceof AtRuleBlock) {
                $removedCount += $this->removeUnusedRules($rule, $selectorsStatus);
                
                // Удаляем пустые @media блоки
                if (empty($rule->getContents())) {
                    $toRemove[] = $rule;
                }
            }
        }
        
        // Удаляем правила после итерации
        foreach ($toRemove as $rule) {
            $cssContainer->remove($rule);
        }
        
        return $removedCount;
    }

    /**
     * Проверяет, является ли правило неиспользуемым
     */
    private function isRuleUnused(DeclarationBlock $rule, array $selectorsStatus): bool
    {
        $selectorObjects = $rule->getSelectors();
        
        foreach ($selectorObjects as $selectorObj) {
            $selector = trim((string)$selectorObj);
            
            // Если хотя бы один селектор используется, правило не удаляем
            if (isset($selectorsStatus[$selector]) && $selectorsStatus[$selector] === 'used') {
                return false;
            }
        }
        
        return true;
    }

    /**
     * Обеспечивает существование каталога
     */
    private function ensureDirectoryExists(string $directory): void
    {
        if (!file_exists($directory)) {
            if (!mkdir($directory, 0755, true)) {
                throw new RuntimeException("Не удалось создать каталог: {$directory}");
            }
        }
    }

    /**
     * Минимизирует CSS
     */
    private function minifyCss(string $css): string
    {
        // Удаляем комментарии
        $css = preg_replace('!/\*[^*]*\*+([^/][^*]*\*+)*/!', '', $css);
        
        // Удаляем лишние пробелы и переносы строк
        $css = preg_replace('/\s+/', ' ', $css);
        
        // Удаляем пробелы вокруг специальных символов
        $css = preg_replace('/\s*([{}:;,>+~])\s*/', '$1', $css);
        
        // Удаляем последнюю точку с запятой перед }
        $css = preg_replace('/;+}/', '}', $css);
        
        // Удаляем пробелы в начале и конце
        return trim($css);
    }

    /**
     * Отправляет успешный ответ
     */
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

    /**
     * Отправляет успешный ответ со статистикой
     */
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

    /**
     * Отправляет ошибку
     */
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

    /**
     * Логирует ошибку
     */
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

// Обработка CORS для разработки
if (isset($_SERVER['HTTP_ORIGIN'])) {
    $allowedOrigins = [
        $_SERVER['HTTP_HOST'] ?? 'localhost'
    ];
    
    $origin = $_SERVER['HTTP_ORIGIN'];
    $parsedOrigin = parse_url($origin);
    
    if (isset($parsedOrigin['host']) && in_array($parsedOrigin['host'], $allowedOrigins, true)) {
        header("Access-Control-Allow-Origin: {$origin}");
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, X-Action');
    }
}

// Обработка preflight запросов
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Запуск обработчика
try {
    $processor = new RemoveUnusedCSSProcessor();
    $processor->processRequest();
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    
    $response = [
        'success' => false,
        'error' => 'Critical error occurred',
        'message' => $e->getMessage()
    ];
    
    echo json_encode($response, JSON_UNESCAPED_UNICODE);
    
    // Логируем критическую ошибку
    error_log(sprintf(
        "[CRITICAL ERROR] %s in %s:%d\n%s\n",
        $e->getMessage(),
        $e->getFile(),
        $e->getLine(),
        $e->getTraceAsString()
    ));
}
