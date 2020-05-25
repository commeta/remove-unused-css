<?php
/*
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2020 Commeta
 * Released under the GPL v3 or MIT license
 * 
 * System requirements: PHP 7.4
 * 
 * Use forked library: PHP CSS Parser
 * https://github.com/sabberworm/PHP-CSS-Parser
 * 
 */
 
header('Content-type: application/json');
if(!isset($_POST['json'])) die(json_encode([]));
$json= json_decode($_POST['json'], true);
set_time_limit(100); // Если будет много файлов можно не успеть, дописать распараллеливание

$data= __DIR__.'/data';
if( !is_dir(__DIR__."/data") ) mkdir(__DIR__."/data", 0755, true);

if($json['mode'] == 'save'){
	//if($_SERVER['REMOTE_ADDR'] != '127.0.0.1') die(json_encode(['status'=> 'remove'])); // Для запуска на продакшн, можно вписать свой ip
	
	if( file_exists($data."/data_file") ) { 
		$data_file= unserialize( file_get_contents($data."/data_file") );
	} else {
		$data_file= [];
	}

	if( !isset($data_file['complete']) ) $data_file['complete']= 'manual';
	
	/*
	if( $data_file['complete'] == 'generate' ) {
		die(json_encode(['status'=> 'generate', 'created'=> [], 'removed'=> 0 ]));
	}
	*/
	
	
	////////////////////////////////////////////////////////////////////////
	// 	Массив классов в файле
	if( !isset($data_file['rules_files']) ) $data_file['rules_files']= [];
		
	foreach($json['rules_files'] as $file=>$rules){
		if( !isset($data_file['rules_files'][$file]) ) $data_file['rules_files'][$file]= [];
		
		foreach($rules as $rule){
			if( !in_array($rule, $data_file['rules_files'][$file]) ) {
				$data_file['rules_files'][$file][]= $rule;
			}
		}
	}
	
	
	////////////////////////////////////////////////////////////////////////
	// 	Общая количество css классов 
	if( !isset($data_file['rules_length']) ){ 
		$data_file['rules_length']= [];
	} 
	
	if( !isset($data_file['rules_length'][$json['pathname']]) ){ 
		$data_file['rules_length'][$json['pathname']]= $json['rules_length'];
	} 
	
	
	////////////////////////////////////////////////////////////////////////
	// Массив файлов стилей
	if( isset($data_file['filesCSS']) ) { 
		$data_file['filesCSS']= array_unique( array_merge($data_file['filesCSS'], $json['filesCSS']));
	} else {
		$data_file['filesCSS']= $json['filesCSS'];
	}
	
	
	////////////////////////////////////////////////////////////////////////
	// Массив файлов стилей, по страницам
	if( !isset($data_file['filesCSS_page']) ){ 
		$data_file['filesCSS_page']= [$json['pathname']=>$json['filesCSS']];
	} 
	$data_file['filesCSS_page'][$json['pathname']]= $json['filesCSS'];
	

	////////////////////////////////////////////////////////////////////////
	// Массив неиспользуемых правил, по страницам
	if( !isset($data_file['unused']) ){ 
		$data_file['unused']= [$json['pathname']=>$json['unused']];
	}
	
	$st= 'rrr';
	// Добавить при появлении нового правила, перепроверку присутствия удаленных для страницы
	if( isset($data_file['unused'][$json['pathname']]) ){ 
		if( count($data_file['unused'][$json['pathname']]) > count($json['unused']) ){
			$data_file['unused'][$json['pathname']]= $json['unused'];
			$st= '>';
		}
		
		if( $data_file['rules_length'][$json['pathname']] <= $json['rules_length'] && count($data_file['unused'][$json['pathname']]) > count($json['unused']) ){
			$data_file['unused'][$json['pathname']]= $json['unused'];
			$st= '<=';
		}
	} else {
		$data_file['unused'][$json['pathname']]= $json['unused'];
		$st= '!';
	}

	
	if( $data_file['rules_length'][$json['pathname']] < $json['rules_length'] ){
		$data_file['rules_length'][$json['pathname']]= $json['rules_length'];
	}

	
	$data_file['complete']= 'manual';
	
	file_put_contents( $data."/data_file", serialize($data_file) );
	die(json_encode([
		'status'=> 'complete', 
		'unused_length'=> count($data_file['unused'][$json['pathname']]), 
		'rules_length'=> $data_file['rules_length'][$json['pathname']],
		'st'=>$st
	]));
	
}

// Добавить в коммерческой версии, возможность из панели управления замены исходных правил, с возможностью восстановления из резервной копии
// Кнопки: Очистить для текущей страницы, очистить для всех



if($json['mode'] == 'generate'){ // Создаем новые CSS файлы, без неиспользуемых стилей
	spl_autoload_register(function($class){
		$file = __DIR__.'/lib/'.strtr($class, '\\', '/').'.php';
		if (file_exists($file)) {
			require $file;
			return true;
		}
	});
	
	if( file_exists($data."/data_file") ) { 
		$data_file= unserialize( file_get_contents($data."/data_file") );
		
		$filesCSS= $data_file['filesCSS'];
	} else {
		die(json_encode(['status'=>'error']));
	}
	
	
	$removed= 0;
	$all_unused= [];
	
	foreach($filesCSS as $file){ // Раскидаем по файлам правила для удаления
		$all_unused[$file]= [];
		
		$isPresent= array_filter($data_file['filesCSS_page'], fn($v) => in_array($file, $v) );
		$pages= array_keys($isPresent);
		
		if(!is_array($pages) || count($pages) < 1) continue;
		
		$all_unused_file= [];
		
		// Вычислить схождение и расхождение
		$diff= [];
		$intersect= [];
		
		foreach($pages as $page){
			if(!isset($data_file['unused'][$page])) continue;
			
			if( count($diff) < 1 ) $diff= $data_file['unused'][$page];
			else $diff= array_diff_assoc($diff, $data_file['unused'][$page]);
			
			if( count($intersect) < 1 ) $intersect= $data_file['unused'][$page];
			else $intersect= array_intersect($intersect, $data_file['unused'][$page]);
		}
		
		foreach($diff as $selector){
			// Проверить присутствие селектора в файле!
			if( !in_array($selector, $data_file['rules_files'][$file]) ) continue;
						
			if( in_array($selector, $intersect) ) {
				if( !in_array($selector, $all_unused_file) ) {
					$all_unused_file[]= $selector;
					$removed++;
				}
			}
		}
		
		$all_unused[$file]= $all_unused_file;
	}
	

	$css_combine= "";
	$created= [];
		
	foreach($filesCSS as $file){
		$path= parse_url($file)['path'];
		$created[]= basename(__DIR__).'/css'.$path;
		
		if( !is_dir(__DIR__."/css/".dirname($path)) ) mkdir(__DIR__."/css/".dirname($path), 0755, true);
		$path= __DIR__."/css".$path;
		
		
		// Прогоним через парсер, удалим ошибки, и нормализуем формат.
		$sSource= file_get_contents($file);
		$oParser= new Sabberworm\CSS\Parser($sSource);
		$oCss= $oParser->parse();
		removeSelectors($oCss);
		
		$text_css= "\n".$oCss->render(Sabberworm\CSS\OutputFormat::createPretty()); // createPretty - читаемый вид, createCompact - минифицированный
		
		
		// Удаление правил на регулярках!
		foreach($all_unused[$file] as $class){
			$text_css= preg_replace( sprintf('/\n\s?\t?(%s\s*\{[^\}]*?})/', preg_quote($class)), "\n", $text_css );
		}
		
		
		// Минификация
		$oParser= new Sabberworm\CSS\Parser($text_css);
		$oCss= $oParser->parse();
		$text_css= $oCss->render(Sabberworm\CSS\OutputFormat::createCompact()); // createPretty - читаемый вид, createCompact - минифицированный
		
		file_put_contents( $path, $text_css );
		
		$css_combine.= preg_replace_callback( // Заменить пути на относительные от корня домена
			'/url\("([^)]*)"\)/',
			function ($matches) {
				global $file;
				return sprintf('url("%s")',rel2abs($matches[1], $file));
			},
			$text_css
		);
	}

	// Генерирует общий файл объединяющий все вместе, можно подключать его вместо всех остальных
	$created[]= basename(__DIR__).'/css/remove-unused-css.min.css';
	file_put_contents(__DIR__.'/css/remove-unused-css.min.css', $css_combine);
	
	
	$data_file['complete']= 'generate';
	file_put_contents( $data."/data_file", serialize($data_file) );
	
	
	die(json_encode(['status'=> 'generate', 'created'=> $created, 'removed'=> $removed]));
}


function removeSelectors($oList) { // Удаление пустых селекторов
	foreach ($oList->getContents() as $oBlock) {
		if($oBlock instanceof Sabberworm\CSS\RuleSet\DeclarationBlock) {
			if ( empty($oBlock->getRules()) ) {
				$oList->remove( $oBlock );
			}
		} else if($oBlock instanceof Sabberworm\CSS\CSSList\CSSBlockList) {
			removeSelectors($oBlock);
			if (empty($oBlock->getContents())) {
				$oList->remove($oBlock);
			}
		}
	}
}


function rel2abs( $rel, $base ) {
	// parse base URL  and convert to local variables: $scheme, $host,  $path
	// http://www.gambit.ph/converting-relative-urls-to-absolute-urls-in-php/
	
	if ( strpos( $rel, "data" ) === 0 ) {
		return $rel;
	}
	
	extract( parse_url( $base ) );

	if ( strpos( $rel,"//" ) === 0 ) {
		return $scheme . ':' . $rel;
	}
	
	// return if already local URL from root
	if ( $rel[0] == '/' ) {
		return $rel;
	}

	// return if already absolute URL
	if ( parse_url( $rel, PHP_URL_SCHEME ) != '' ) {
		return $rel;
	}

	// queries and anchors
	if ( $rel[0] == '#' || $rel[0] == '?' ) {
		return $base . $rel;
	}

	// remove non-directory element from path
	$path = preg_replace( '#/[^/]*$#', '', $path );

	// dirty absolute URL
	$abs =  $path . "/" . $rel;

	// replace '//' or  '/./' or '/foo/../' with '/'
	$abs = preg_replace( "/(\/\.?\/)/", "/", $abs );
	$abs = preg_replace( "/\/(?!\.\.)[^\/]+\/\.\.\//", "/", $abs );

	// absolute URL is ready!
	return $abs;
}

?>
