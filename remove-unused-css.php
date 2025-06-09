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

use Sabberworm\CSS\Parser;
use Sabberworm\CSS\CSSList\Document;
use Sabberworm\CSS\RuleSet\DeclarationBlock;
use Sabberworm\CSS\CSSList\AtRuleBlock;
use Sabberworm\CSS\Property\AtRule;
use Sabberworm\CSS\Value\RuleValueList;
use Sabberworm\CSS\Renderable;

class RemoveUnusedCSSProcessor
{
    private const SF = 'data/unused_selectors.json';
    private const CD = 'css/';
    private const CF = 'remove-unused-css.min.css';
    private const MFS = 10 * 1024 * 1024;
    private const BD = 'backup/';
    private const SET = 'data/settings.json';
    private const VER = 'data/version.json';

    private string $dr;
    private string $bd;
    private array $e = [];
    private array $pf = [];
    private array $st = [];
    private array $cfg = [
        'media' => true,
        'media_print' => true,
        'keyframes' => true,
        'font_face' => true,
        'import' => true,
        'supports' => true,
        'page' => true,
        'charset' => true,
        'counter_style' => true,
        'layer' => true,
        'pseudo_classes' => true,
        'pseudo_elements' => true,
        'attribute_selectors' => true,
        'css_variables' => true,
        'vendor_prefixes' => true,
        'adjacent_selectors' => true,
        'child_selectors' => true,
        'general_siblings' => true,
        'css_functions' => true,
        'animations' => true,
        'transforms' => true,
        'transitions' => true,
        'percentages' => true,
        'escapes' => true,
        'colors' => true,
        'gradients' => true,
        'filters' => true,
        'masks' => true,
        'nth_selectors' => true,
        'logical_selectors' => true,
        'version' => 1
    ];
    private array $cp = [];
    private array $cs = [
        'html', 'body', '*', ':root', 'head', 'title', 'meta', 'link', 'script', 'style', 'base'
    ];

    public function __construct()
    {
        $this->dr = $_SERVER['DOCUMENT_ROOT'] ?? '';
        $this->bd = dirname(__FILE__);
        $this->loadSettings();
    }

    private function loadSettings(): void
    {
        $cf = $this->bd . '/' . self::SET;
        if (file_exists($cf)) {
            $c = file_get_contents($cf);
            $s = json_decode($c, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($s)) {
                $this->cfg = array_merge($this->cfg, $s);
            }
        }
        $this->updateCriticalPatterns();
    }

    private function saveSettings(array $s): void
    {
        $cf = $this->bd . '/' . self::SET;
        $this->ensureDirectoryExists(dirname($cf));
        $s['version'] = ($this->cfg['version'] ?? 1) + 1;
        $this->cfg = $s;
        $j = json_encode($s, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($j !== false) {
            file_put_contents($cf, $j, LOCK_EX);
        }
    }

    private function clearOldData(): void
    {
        $sf = $this->bd . '/' . self::SF;
        if (file_exists($sf)) {
            unlink($sf);
        }
    }

    private function updateCriticalPatterns(): void
    {
        $this->cp = [];
        if ($this->cfg['media']) $this->cp[] = '/^@media/i';
        if ($this->cfg['media_print']) $this->cp[] = '/^@media\s+print/i';
        if ($this->cfg['keyframes']) $this->cp[] = '/^@keyframes/i';
        if ($this->cfg['font_face']) $this->cp[] = '/^@font-face/i';
        if ($this->cfg['import']) $this->cp[] = '/^@import/i';
        if ($this->cfg['supports']) $this->cp[] = '/^@supports/i';
        if ($this->cfg['page']) $this->cp[] = '/^@page/i';
        if ($this->cfg['charset']) $this->cp[] = '/^@charset/i';
        if ($this->cfg['counter_style']) $this->cp[] = '/^@counter-style/i';
        if ($this->cfg['layer']) $this->cp[] = '/^@layer/i';
        if ($this->cfg['pseudo_classes']) $this->cp[] = '/:[a-z-]+(?:\([^)]*\))?/i';
        if ($this->cfg['pseudo_elements']) $this->cp[] = '/::[a-z-]+/';
        if ($this->cfg['attribute_selectors']) $this->cp[] = '/\[[\w\-="\':\s]*\]/';
        if ($this->cfg['css_variables']) $this->cp[] = '/--[\w\-]+/';
        if ($this->cfg['vendor_prefixes']) $this->cp[] = '/-webkit-|-moz-|-ms-|-o-/';
        if ($this->cfg['adjacent_selectors']) $this->cp[] = '/\+/';
        if ($this->cfg['child_selectors']) $this->cp[] = '/>/';
        if ($this->cfg['general_siblings']) $this->cp[] = '/~/';
        if ($this->cfg['css_functions']) $this->cp[] = '/\(/';
        if ($this->cfg['animations']) $this->cp[] = '/animation|keyframes/i';
        if ($this->cfg['transforms']) $this->cp[] = '/transform/i';
        if ($this->cfg['transitions']) $this->cp[] = '/transition/i';
        if ($this->cfg['percentages']) $this->cp[] = '/\d+%/';
        if ($this->cfg['escapes']) $this->cp[] = '/\\\\/';
        if ($this->cfg['colors']) $this->cp[] = '/rgb\(|rgba\(|hsl\(|hsla\(/i';
        if ($this->cfg['gradients']) $this->cp[] = '/linear-gradient|radial-gradient/i';
        if ($this->cfg['filters']) $this->cp[] = '/filter|backdrop-filter/i';
        if ($this->cfg['masks']) $this->cp[] = '/mask|clip-path/i';
        if ($this->cfg['nth_selectors']) $this->cp[] = '/nth-child|nth-of-type/i';
        if ($this->cfg['logical_selectors']) $this->cp[] = '/not\(|is\(|where\(|has\(/i';
    }

    public function processRequest(): void
    {
        try {
            if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
                $this->sendError(405, 'Method Not Allowed');
                return;
            }
            $d = $this->getInputData();
            if (!$d) {
                $this->sendError(400, 'Invalid JSON data');
                return;
            }
            $a = $_SERVER['HTTP_X_ACTION'] ?? ($_GET['action'] ?? 'save');
            if ($a === 'save') {
                $this->saveUnusedSelectors($d);
                $this->sendSuccess('Данные успешно сохранены');
            } elseif ($a === 'generate') {
                $this->generateCSSFiles($d);
                $this->sendSuccessWithStatistics('Файлы успешно сгенерированы');
            } elseif ($a === 'settings' || $a === 'saveSettings') {
                $this->handleSettings($d);
            } else {
                $this->sendError(400, 'Unknown action');
            }
        } catch (Exception $e) {
            $this->logError($e);
            $this->sendError(500, 'Internal Server Error: ' . $e->getMessage());
        }
    }

    private function handleSettings(array $d): void
    {
        if (isset($d['action']) && $d['action'] === 'save' && isset($d['settings'])) {
            $old_cfg = $this->cfg;
            $this->saveSettings($d['settings']);
            $need_reset = false;
            foreach ([
                'media', 'media_print', 'keyframes', 'font_face', 'import', 'supports', 'page', 'charset',
                'counter_style', 'layer', 'pseudo_classes', 'pseudo_elements', 'attribute_selectors',
                'css_variables', 'vendor_prefixes', 'adjacent_selectors', 'child_selectors', 'general_siblings',
                'css_functions', 'animations', 'transforms', 'transitions', 'percentages', 'escapes', 'colors',
                'gradients', 'filters', 'masks', 'nth_selectors', 'logical_selectors'
            ] as $key) {
                if (($old_cfg[$key] ?? true) !== ($d['settings'][$key] ?? true)) {
                    $need_reset = true;
                    break;
                }
            }
            if ($need_reset) {
                $this->clearOldData();
            }
            $this->sendSuccessWithData('Настройки сохранены', ['need_reload' => $need_reset]);
        } elseif (isset($d['action']) && $d['action'] === 'load') {
            $this->sendSuccessWithData('Настройки загружены', ['settings' => $this->cfg]);
        } else {
            $this->sendError(400, 'Invalid settings request');
        }
    }

    private function getInputData(): ?array
    {
        $i = file_get_contents('php://input');
        if (!$i) return null;
        $d = json_decode($i, true);
        if (json_last_error() !== JSON_ERROR_NONE) return null;
        return is_array($d) ? $d : null;
    }

    private function saveUnusedSelectors(array $d): void
    {
        $ms = $this->loadMasterSelectors();
        $this->updateSelectorsUsage($ms, $d);
        $this->saveMasterSelectors($ms);
        $this->pf = array_keys($d);
    }

    private function generateCSSFiles(array $cpd): void
    {
        $ms = $this->loadMasterSelectors();
        $this->updateSelectorsUsage($ms, $cpd);
        $this->saveMasterSelectors($ms);
        $this->createBackup($ms);
        $this->generateCleanCssFiles($ms);
    }

    private function loadMasterSelectors(): array
    {
        $sf = $this->bd . '/' . self::SF;
        if (file_exists($sf)) {
            $c = file_get_contents($sf);
            $s = json_decode($c, true);
            if (json_last_error() === JSON_ERROR_NONE && is_array($s)) {
                return $s;
            }
        }
        return [];
    }

    private function saveMasterSelectors(array $ms): void
    {
        $sf = $this->bd . '/' . self::SF;
        $this->ensureDirectoryExists(dirname($sf));
        $j = json_encode($ms, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        if ($j === false) {
            throw new RuntimeException('Не удалось сериализовать селекторы в JSON');
        }
        if (file_put_contents($sf, $j, LOCK_EX) === false) {
            throw new RuntimeException('Не удалось сохранить файл селекторов');
        }
    }

    private function updateSelectorsUsage(array &$ms, array $d): void
    {
        foreach ($d as $h => $s) {
            $rp = $this->normalizeFilePath($h);
            if (!isset($ms[$rp])) {
                $ms[$rp] = [];
                $fp = $this->getFullFilePath($rp);
                if ($fp && file_exists($fp)) {
                    $this->initializeFileSelectors($fp, $ms[$rp]);
                }
            }
            foreach ($s as $sel_data) {
                $sel = $sel_data['selector'] ?? '';
                if ($sel && isset($ms[$rp][$sel])) {
                    $ms[$rp][$sel] = 'used';
                }
            }
        }
    }

    private function initializeFileSelectors(string $fp, array &$s): void
    {
        try {
            $cc = file_get_contents($fp);
            if ($cc === false) {
                throw new RuntimeException("Не удалось прочитать файл: {$fp}");
            }
            $p = new Parser($cc);
            $cd = $p->parse();
            $this->collectSelectorsFromDocument($cd, $s);
        } catch (Exception $e) {
            $this->e[] = "Ошибка инициализации селекторов для файла {$fp}: " . $e->getMessage();
        }
    }

    private function collectSelectorsFromDocument($cc, array &$s): void
    {
        foreach ($cc->getContents() as $r) {
            if ($r instanceof DeclarationBlock) {
                $so = $r->getSelectors();
                foreach ($so as $soj) {
                    $sel = trim((string)$soj);
                    if (!empty($sel)) {
                        $s[$sel] = $this->isSelectorSafeToRemove($sel) ? 'unused' : 'used';
                    }
                }
            } elseif ($r instanceof AtRuleBlock) {
                $this->collectSelectorsFromDocument($r, $s);
            }
        }
    }

    private function normalizeFilePath(string $p): string
    {
        $p = parse_url($p, PHP_URL_PATH) ?: $p;
        return ltrim($p, '/');
    }

    private function getFullFilePath(string $rp): ?string
    {
        $fp = $this->dr . '/' . $rp;
        $rp2 = realpath($fp);
        $rdr = realpath($this->dr);
        if ($rp2 && $rdr && strpos($rp2, $rdr) === 0) {
            return $rp2;
        }
        return null;
    }

    private function createBackup2(array $ms): void
    {
        return;
        $bd = $this->bd . '/' . self::BD . date('Y-m-d_H-i-s') . '/';
        $this->ensureDirectoryExists($bd);
        foreach ($ms as $rp => $s) {
            $fp = $this->getFullFilePath($rp);
            if ($fp && file_exists($fp)) {
                $bp = $bd . $rp;
                $this->ensureDirectoryExists(dirname($bp));
                copy($fp, $bp);
            }
        }
        $mf = $this->bd . '/' . self::CD . self::CF;
        if (file_exists($mf)) {
            copy($mf, $bd . self::CF);
        }
    }

    /**
     * Создаёт бэкап текущих CSS-файлов из подкаталога css/
     *
     * @param array $ms — master-селекторы (не используются внутри бэкапа, но сохраняются для
     *                   совместимости сигнатуры)
     */
    private function createBackup(array $ms): void
    {
        // имя новой папки типа backup/2025-06-09_04-30-15/
        $timestamp = date('Y-m-d_H-i-s');
        $backupDir = $this->bd . '/' . self::BD . $timestamp . '/';
        $this->ensureDirectoryExists($backupDir);

        // путь к каталогу с очищенными CSS
        $cssDir = $this->bd . '/' . self::CD;

        // если его нет — ничего не бэкапим
        if (!is_dir($cssDir)) {
            return;
        }

        // рекурсивно собираем все файлы из css/
        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($cssDir, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );

        foreach ($iterator as $file) {
            /** @var \SplFileInfo $file */
            if ($file->isFile() && strtolower($file->getExtension()) === 'css') {
                // относительный путь внутри css/, например "sub/style.min.css"
                $relative = substr($file->getPathname(), strlen($cssDir));
                // создаём ту же структуру в backup/YYYY.../
                $targetPath = $backupDir . self::CD . $relative;
                $this->ensureDirectoryExists(dirname($targetPath));
                copy($file->getPathname(), $targetPath);
            }
        }

        // бэкап объединённого минифицированного файла
        $combined = $cssDir . self::CF;
        if (file_exists($combined)) {
            copy($combined, $backupDir . self::CD . self::CF);
        }
    }


    
    private function generateCleanCssFiles(array $ms): void
    {
        $cd = $this->bd . '/' . self::CD;
        $this->ensureDirectoryExists($cd);
        $cc = '';
        $ic = '';
        $tos = 0;
        $tfs = 0;
        $tsr = 0;
        $gf = 0;
        foreach ($ms as $rp => $s) {
            try {
                $fp = $this->getFullFilePath($rp);
                if (!$fp || !file_exists($fp) || !is_readable($fp)) {
                    $this->e[] = "Файл не найден или недоступен: {$rp}";
                    continue;
                }
                $os = filesize($fp);
                $tos += $os;
                $r = $this->processFile($fp, $s);
                if ($r && !empty($r['css'])) {
                    $ccp = $cd . $rp;
                    $this->ensureDirectoryExists(dirname($ccp));
                    $mcss = $this->minifyCss($r['css']);
                    if (file_put_contents($ccp, $mcss) !== false) {
                        $this->pf[] = $rp;
                        $gf++;
                        $fs = strlen($mcss);
                        $tfs += $fs;
                        $tsr += $r['removed_selectors'];
                        $ic .= ($r['import_charset'] ?? '');
                        $cc .= $mcss . "\n\n";
                    } else {
                        $this->e[] = "Не удалось сохранить файл: {$ccp}";
                    }
                }
            } catch (Exception $e) {
                $this->e[] = "Ошибка обработки файла {$rp}: " . $e->getMessage();
            }
        }
        $cs = 0;
        if (!empty($cc)) {
            $cp = $cd . self::CF;
            $fc = $ic . $cc;
            $cs = strlen($fc);
            if (file_put_contents($cp, $fc) !== false) {
                $gf++;
            } else {
                $this->e[] = "Не удалось создать объединенный файл: {$cp}";
            }
        }
        $this->st = [
            'processed_files' => count($this->pf),
            'generated_files' => $gf,
            'combined_file' => !empty($cc),
            'original_size' => $tos,
            'final_size' => $tfs,
            'combined_size' => $cs,
            'bytes_saved' => $tos - $tfs,
            'selectors_removed' => $tsr
        ];
    }

    private function processFile(string $fp, array $ss): ?array
    {
        $fs = filesize($fp);
        if ($fs > self::MFS) {
            throw new RuntimeException("Файл слишком большой: {$fp}");
        }
        $cc = file_get_contents($fp);
        if ($cc === false) {
            throw new RuntimeException("Не удалось прочитать файл: {$fp}");
        }
        try {
            $p = new Parser($cc);
            $cd = $p->parse();
            $ic = '';
            $rs = $this->removeUnusedRules($cd, $ss, $ic);
            return [
                'css' => $cd->render(),
                'removed_selectors' => $rs,
                'import_charset' => $ic
            ];
        } catch (Exception $e) {
            throw new RuntimeException("Ошибка парсинга CSS в файле {$fp}: " . $e->getMessage());
        }
    }

    private function removeUnusedRules($cc, array $ss, string &$ic): int
    {
        $c = $cc->getContents();
        $tr = [];
        $rc = 0;
        foreach ($c as $r) {
            if ($r instanceof DeclarationBlock) {
                $result = $this->processDeclarationBlock($r, $ss);
                if ($result['remove']) {
                    $tr[] = $r;
                    $rc += $result['count'];
                } elseif ($result['modified']) {
                    $rc += $result['count'];
                }
            } elseif ($r instanceof AtRuleBlock) {
                $rt = strtolower($r->atRuleName());
                if (in_array($rt, ['charset', 'import'])) {
                    $ic .= $r->render() . "\n";
                    $tr[] = $r;
                    continue;
                }
                if ($this->shouldPreserveAtRule($rt)) {
                    continue;
                }
                if (in_array($rt, ['supports', 'media', 'document', 'layer', 'container'])) {
                    $rc += $this->removeUnusedRules($r, $ss, $ic);
                    if (empty($r->getContents())) {
                        $tr[] = $r;
                    }
                } elseif (!$this->isAtRuleAllowed($rt)) {
                    $tr[] = $r;
                }
            }
        }
        foreach ($tr as $r) {
            $cc->remove($r);
        }
        return $rc;
    }

    private function shouldPreserveAtRule(string $rt): bool
    {
        $preserve_map = [
            'keyframes' => 'keyframes',
            'font-face' => 'font_face',
            'page' => 'page',
            'counter-style' => 'counter_style',
            'layer' => 'layer'
        ];
        return isset($preserve_map[$rt]) && $this->cfg[$preserve_map[$rt]];
    }

    private function isAtRuleAllowed(string $rt): bool
    {
        $allow_map = [
            'media' => 'media',
            'supports' => 'supports'
        ];
        return isset($allow_map[$rt]) && $this->cfg[$allow_map[$rt]];
    }

    private function processDeclarationBlock(DeclarationBlock $r, array $ss): array
    {
        $so = $r->getSelectors();
        $us = [];
        $rs = 0;
        foreach ($so as $soj) {
            $s = trim((string)$soj);
            if ($this->isSelectorSafeToRemove($s) && (!isset($ss[$s]) || $ss[$s] === 'unused')) {
                $rs++;
                continue;
            }
            $us[] = $soj;
        }
        if (empty($us)) {
            return ['remove' => true, 'count' => count($so), 'modified' => false];
        }
        if (count($us) < count($so)) {
            $r->setSelectors($us);
            return ['remove' => false, 'count' => $rs, 'modified' => true];
        }
        return ['remove' => false, 'count' => 0, 'modified' => false];
    }

    private function isSelectorSafeToRemove(string $s): bool
    {
        if (empty($s)) return false;
        $t = trim($s);
        if (in_array(strtolower($t), $this->cs, true)) {
            return false;
        }
        foreach ($this->cp as $p) {
            if (preg_match($p, $t)) {
                return false;
            }
        }
        return true;
    }

    private function ensureDirectoryExists(string $d): void
    {
        if (!file_exists($d)) {
            if (!mkdir($d, 0755, true)) {
                throw new RuntimeException("Не удалось создать каталог: {$d}");
            }
        }
    }

    private function minifyCss(string $c): string
    {
        $c = preg_replace('!/\*[^*]*\*+([^/][^*]*\*+)*/!', '', $c);
        $c = preg_replace('/\s+/', ' ', $c);
        $c = preg_replace('/\s*([{}:;,>+~])\s*/', '$1', $c);
        $c = preg_replace('/;+}/', '}', $c);
        $c = preg_replace('/;\s*;+/',';',$c);
        return trim($c);
    }

    private function sendSuccess(string $m): void
    {
        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        $r = [
            'success' => true,
            'message' => $m,
            'processed_files' => $this->pf,
            'errors' => $this->e
        ];
        echo json_encode($r, JSON_UNESCAPED_UNICODE);
    }

    private function sendSuccessWithData(string $m, array $d): void
    {
        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        $r = [
            'success' => true,
            'message' => $m,
            'data' => $d,
            'errors' => $this->e
        ];
        echo json_encode($r, JSON_UNESCAPED_UNICODE);
    }

    private function sendSuccessWithStatistics(string $m): void
    {
        http_response_code(200);
        header('Content-Type: application/json; charset=utf-8');
        $r = [
            'success' => true,
            'message' => $m,
            'processed_files' => $this->pf,
            'statistics' => $this->st,
            'errors' => $this->e
        ];
        echo json_encode($r, JSON_UNESCAPED_UNICODE);
    }

    private function sendError(int $c, string $m): void
    {
        http_response_code($c);
        header('Content-Type: application/json; charset=utf-8');
        $r = [
            'success' => false,
            'error' => $m,
            'errors' => $this->e
        ];
        echo json_encode($r, JSON_UNESCAPED_UNICODE);
    }

    private function logError(Exception $e): void
    {
        $lm = sprintf(
            "[%s] %s in %s:%d\nStack trace:\n%s\n",
            date('Y-m-d H:i:s'),
            $e->getMessage(),
            $e->getFile(),
            $e->getLine(),
            $e->getTraceAsString()
        );
        error_log($lm, 3, $this->bd . '/error.log');
    }
}

if (isset($_SERVER['HTTP_ORIGIN'])) {
    $ao = [$_SERVER['HTTP_HOST'] ?? 'localhost'];
    $o = $_SERVER['HTTP_ORIGIN'];
    $po = parse_url($o);
    if (isset($po['host']) && in_array($po['host'], $ao, true)) {
        header("Access-Control-Allow-Origin: {$o}");
        header('Access-Control-Allow-Credentials: true');
        header('Access-Control-Allow-Methods: POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, X-Action');
    }
}
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}
try {
    $p = new RemoveUnusedCSSProcessor();
    $p->processRequest();
} catch (Throwable $e) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    $r = [
        'success' => false,
        'error' => 'Critical error occurred',
        'message' => $e->getMessage()
    ];
    echo json_encode($r, JSON_UNESCAPED_UNICODE);
    error_log(sprintf(
        "[CRITICAL ERROR] %s in %s:%d\n%s\n",
        $e->getMessage(),
        $e->getFile(),
        $e->getLine(),
        $e->getTraceAsString()
    ));
}
?>
