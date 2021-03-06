<?php
/*
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2020 Commeta
 * Released under the GPL v3 or MIT license
 * 
 * System requirements: PHP 7.4
 */
 
header('Content-type: application/json');
if(!isset($_POST['json'])) die(json_encode([]));
$json= json_decode($_POST['json'], true);
set_time_limit(50);

$data= __DIR__.'/data';
if( !is_dir(__DIR__."/data") ) mkdir(__DIR__."/data", 0755, true);

if($json['mode'] == 'save'){
	//if($_SERVER['REMOTE_ADDR'] != '127.0.0.1') die(json_encode(['status'=> 'remove'])); // Для запуска на продакшн, можно вписать свой ip, доделать
	
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
	// 	Общее количество css классов 
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
	} else {
		$data_file['filesCSS_page'][$json['pathname']]= $json['filesCSS'];
	}
	
	
	////////////////////////////////////////////////////////////////////////
	// Массив неиспользуемых правил, по страницам
	$stat= 'read';
	if( isset($data_file['unused'][$json['pathname']]) ){ 
		if( count($data_file['unused'][$json['pathname']]) > count($json['unused']) ){
			$data_file['unused'][$json['pathname']]= $json['unused'];
			$stat= '>';
		}
		
		if( $data_file['rules_length'][$json['pathname']] < $json['rules_length'] ){
			$data_file['unused'][$json['pathname']]= $json['unused'];
			$stat= '<';
		}
	} else {
		$data_file['unused'][$json['pathname']]= $json['unused'];
		$stat= '!';
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
		'stat'=>$stat
	]));
	
}

// Добавить в коммерческой версии, возможность из панели управления замены исходных правил, с возможностью восстановления из резервной копии
// Кнопки: Очистить для текущей страницы, очистить для всех



if($json['mode'] == 'generate'){ // Создаем новые CSS файлы, без неиспользуемых стилей
	if( file_exists($data."/data_file") ) { 
		$data_file= unserialize( file_get_contents($data."/data_file") );
	} else {
		die(json_encode(['status'=>'error']));
	}
	
	// Инициализация
	$css_combine= "";
	
	$all_unused= [];
	$removed_in_file= [];
	$first_lines= [];
	$created= [];
	$not_find= [];
	
	$old_size= 0;
	$removed= 0;
	
	
	foreach($data_file['filesCSS'] as $file){ // Генерация очищенных файлов
		$removed_in_file[$file]= 0;
		
		// Массив всех страниц где подключен этот css файл
		$pages= array_keys(array_filter($data_file['filesCSS_page'], fn($v) => in_array($file, $v)));
		if(!is_array($pages) || count($pages) < 1) continue;
		
		// Вычислить схождение 
		$all_unused_file= $data_file['rules_files'][$file];
		foreach($pages as $page){
			if(!isset($data_file['unused'][$page])) continue;
			$all_unused_file= array_intersect($all_unused_file, $data_file['unused'][$page]);
		}
		
		// Статистика
		$removed_in_file[$file]= count($all_unused_file);
		$removed += $removed_in_file[$file];


		// Воссоздадим структуру каталогов
		$path= parse_url($file)['path'];
		$created[]= basename(__DIR__).'/css'.$path;
		
		if( !is_dir(__DIR__."/css/".dirname($path)) ) mkdir(__DIR__."/css/".dirname($path), 0755, true);
		$path= __DIR__."/css".$path;
		

		// Минифицируем CSS.
		$sSource= file_get_contents($file);
		$old_size += ini_get('mbstring.func_overload') ? mb_strlen($sSource , '8bit') : strlen($sSource);
		$text_css= "}".minify_css($sSource);
		
		
		// Удаление правил на регулярках!
		$search= [];
		foreach($all_unused_file as $class){
			$minify_class= minify_css($class);
			$s= sprintf('/}%s\s?\{[^\}]*?}/', preg_quote($minify_class));
			
			// Массив ненайденных классов
			if(preg_match($s, $text_css) == 0) {
				$not_found= [];
			
				if( strpos($class, '"') !== false ) { // Добавим проверку без кавычек
					$c= minify_css(str_replace('"', '', $class));
					$s2= sprintf('/}%s\s?\{[^\}]*?}/', preg_quote($c));
					
					if(preg_match($s2, $text_css) == 0) {
						$not_found[]= true;
					} else {
						$search[]= $s2;
						$not_found[]= false;
					}
				}
				
				if(preg_match('/(\+|\>|\*|\:|~)/', $class) == 1){ // Проверки с доп. пробелами
					$s3= sprintf(
						'/}%s\s?\{[^\}]*?}/', 
						str_replace(
							[" ",   "\+",       "\>",       '~',       '\*',       '\:',        "\s?\s?"], 
							["\s?", "\s?\+\s?", "\s?\>\s?", '\s?~\s?', '\s?\*\s?', '\s?\:\s?',  "\s?"], 
							preg_quote($minify_class)
						)
					);
					
					if(preg_match($s3, $text_css) == 0) {
						$not_found[]= true;
					} else {
						$search[]= $s3;
						$not_found[]= false;
					}
				}
				
				// Массив ненайденных классов
				if(count($not_found) > 1 && $not_found[0] && $not_found[1]) $not_find[]= $minify_class;
			} else { 
				$search[]= $s;
			}
		}
		
		$text_css= preg_replace( $search, "}", $text_css );
		$text_css= substr($text_css, 1); // Удалить маркер "}"
		
		
		file_put_contents( $path, $text_css );
		
		// Заменить пути на относительные от корня домена
		$text_css= preg_replace_callback( 
			'/url\((?!"?data)"?([^)]*)"?\)/iu',
			function ($matches) use($file){
				return 
					sprintf(
						'url("%s")',
						rel2abs(
							preg_replace(
								["/'/", '/"/', '/^([^?]+)(\?.*?)?(#.*)?$/' ], 
								["",    "",    '$1$3'], 
								$matches[1]
							), 
							$file
						)
					);
			},
			$text_css
		);
		
		
		// Обработка @import - перенос в начало файла
		// надо по идее их сюда вставлять с удалением правил - потестить!
		if( preg_match_all("/@\s?import\s?[^;]*?;/iu", $text_css, $matches_import) != 0){
			if( isset($matches_import[0]) ){
				foreach($matches_import[0] as $import){
					$text_css= str_replace($import, '', $text_css);
					$import= str_replace("'", '"', $import);
					
					if( preg_match('/url/iu', $import) == 0 ){
						$import= preg_replace_callback( 
							'/"(.*)"/',
							function ($matches) use($file) {
								return 
									sprintf(
										'"%s"',
										rel2abs(
											preg_replace(
												["/'/",'/"/'], 
												'',
												$matches[1]
											), 
											$file
										)
									);
							},
							$import
						);
						
					}
					$first_lines[]= $import;
				}
			}
		}
		
		
		// Обработка @charset, если не utf-8 - то пока остановим создание общего файла
		if( preg_match("/@\s?charset\s?[^;]*?;/", $text_css, $matches_charset) != 0){
			if( isset($matches_charset[0]) ){
				$file_charset= $matches_charset[0];
				$text_css= str_replace($file_charset, '', $text_css);
				
				if( preg_match('/utf-8/iu', $file_charset) == 1 ){
					$text_css= str_replace($file_charset, '', $text_css);
					$charset[]= 'utf-8';
				} else {
					$charset[]= $file_charset;
				}
			}
		}
		
		$css_combine.= $text_css;
	}
	
	if( isset($charset) ) {
		foreach($charset as $ct){
			if($ct != 'utf-8') $css_combine= '';
		}
	}

	// Обработка @import - перенос в начало файла
	if( count($first_lines) > 0 && $css_combine != ''){
		$str= '';
		foreach($first_lines as $line){
			$str.= $line;
		}
		$css_combine= $str.$css_combine;
	}


	// Генерирует общий файл объединяющий все вместе, можно подключать его вместо всех остальных
	if($css_combine != ''){
		$created[]= basename(__DIR__).'/css/remove-unused-css.min.css';
		file_put_contents(__DIR__.'/css/remove-unused-css.min.css', $css_combine);
	}
	
	
	$data_file['complete']= 'generate';
	file_put_contents( $data."/data_file", serialize($data_file) );
	$new_size= ini_get('mbstring.func_overload') ? mb_strlen($css_combine , '8bit') : strlen($css_combine);
	
	
	$removed -= count($not_find);
	
	die(json_encode([
		'status'=> 'generate', 
		'created'=> $created, 
		'removed'=> $removed,
		'old_size'=> $old_size,
		'new_size'=> $new_size,
		'removed_in_file'=> $removed_in_file,
		'not_find'=> $not_find
	]));
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



function minify_css( $string = '' ) {
	// https://stackoverflow.com/questions/15195750/minify-compress-css-with-regex

    $comments = <<<'EOS'
(?sx)
    # don't change anything inside of quotes
    ( "(?:[^"\\]++|\\.)*+" | '(?:[^'\\]++|\\.)*+' )
|
    # comments
    /\* (?> .*? \*/ )
EOS;

    $everything_else = <<<'EOS'
(?six)
    # don't change anything inside of quotes
    ( "(?:[^"\\]++|\\.)*+" | '(?:[^'\\]++|\\.)*+' )
|
    # spaces before and after ; and }
    \s*+ ; \s*+ ( } ) \s*+
|
    # all spaces around meta chars/operators (excluding + and -)
    \s*+ ( [*$~^|]?+= | [{};,>~] | !important\b ) \s*+
|
    # all spaces around + and - (in selectors only!)
    \s*([+-])\s*(?=[^}]*{)
|
    # spaces right of ( [ :
    ( [[(:] ) \s++
|
    # spaces left of ) ]
    \s++ ( [])] )
|
    # spaces left (and right) of : (but not in selectors)!
    \s+(:)(?![^\}]*\{)
|
    # spaces at beginning/end of string
    ^ \s++ | \s++ \z
|
    # double spaces to single
    (\s)\s+
EOS;

    $search_patterns  = array( "%{$comments}%", "%{$everything_else}%" );
    $replace_patterns = array( '$1', '$1$2$3$4$5$6$7$8' );

    return preg_replace( $search_patterns, $replace_patterns, $string );
}
?>
