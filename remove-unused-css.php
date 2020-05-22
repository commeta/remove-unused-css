<?php
/*
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2020 Commeta
 * Released under the GPL v3 or MIT license
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

if($json['mode'] == 'auto' || $json['mode'] == 'save'){
	//if($_SERVER['REMOTE_ADDR'] != '127.0.0.1') die(json_encode([])); // Для запуска на продакшн, можно вписать свой ip


	////////////////////////////////////////////////////////////////////////
	// Массив файлов стилей
	if( file_exists($data."/filesCSS") ) { 
		$filesCSS= array_unique( array_merge(unserialize( file_get_contents($data."/filesCSS") ), $json['filesCSS']));
	} else {
		$filesCSS= $json['filesCSS'];
	}
	
	file_put_contents( $data."/filesCSS", serialize($filesCSS) );
	
	
	////////////////////////////////////////////////////////////////////////
	// Массив файлов стилей, по страницам
	//if( file_exists($data."/filesCSS_page") ) { 
		//$filesCSS_page= unserialize( file_get_contents($data."/filesCSS_page") );
	//} else {
		//$filesCSS_page= [$json['pathname']=> $json['filesCSS']];
	//}
	
	//$filesCSS_page[$json['pathname']]= $json['filesCSS'];
	//file_put_contents( $data."/filesCSS_page", serialize($filesCSS_page) );
	
	
	
	
	////////////////////////////////////////////////////////////////////////
	// Массив неиспользуемых правил, по страницам
	if( file_exists($data."/unused") ) { 
		$unused= unserialize( file_get_contents($data."/unused") );
	} else {
		$unused= [$json['pathname']=>$json['unused']];
	}

	$unused[$json['pathname']]= $json['unused'];
	file_put_contents( $data."/unused", serialize($unused) );


	////////////////////////////////////////////////////////////////////////
	// Массив ссылок для обхода страниц
	if( file_exists($data."/links") ) {
		$links= array_merge( unserialize( file_get_contents($data."/links") ), $json['links'] );
	} else {
		$links= $json['links'];
	}

	$links= array_unique($links);
	file_put_contents( $data."/links", serialize($links) );


	////////////////////////////////////////////////////////////////////////
	// Массив файлов no html
	if( file_exists($data."/no_html") ) { 
		$no_html= unserialize( file_get_contents($data."/no_html") );
	} else {
		$no_html= [];
	}
	
	////////////////////////////////////////////////////////////////////////
	// Массив уже обойденных страниц
	if( file_exists($data."/visited") ) { 
		$visited= unserialize( file_get_contents($data."/visited") );
	} else {
		$visited= [];
	}

	$visited[]= $json['pathname'];
	file_put_contents( $data."/visited", serialize($visited) );


	if($json['mode'] == 'auto'){
		foreach($links as $link){ // Посылаем в браузер следующую ссылку, если это html
			if( !in_array($link, $visited) && !in_array($link, $no_html) ){
				if( strpos( get_headers($json['host'].$link, 1)['Content-Type'], 'text/html') !== false  ){
					file_put_contents( $data."/no_html", serialize($no_html) );
					
					die(json_encode(['status'=> 'ok', 'location' => $link]));
				} else {
					$no_html[]= $link;
				}
			}
		}
	}
	
	file_put_contents( $data."/no_html", serialize($no_html) );
	
	
	// Вернуть количество сохраненных элементов на этой странице, для сравнения в браузере
	die(json_encode(['status'=> 'complete']));
}



if($json['mode'] == 'generate'){ // Создаем новые CSS файлы, без неиспользуемых стилей
	spl_autoload_register(function($class){
		$file = __DIR__.'/lib/'.strtr($class, '\\', '/').'.php';
		if (file_exists($file)) {
			require $file;
			return true;
		}
	});
	
	
	if( file_exists($data."/filesCSS") ) { 
		$filesCSS= unserialize( file_get_contents($data."/filesCSS") );
	} else {
		$filesCSS= [];
	}
	
	/*
	if( file_exists($data."/filesCSS_page") ) { 
		$filesCSS_page= unserialize( file_get_contents($data."/filesCSS_page") );
	} else {
		$filesCSS_page= [];
	}
	*/
	
	if( file_exists($data."/unused") ) { 
		$all_unused= unserialize( file_get_contents($data."/unused") );
	} else {
		$all_unused= [];
	}
	
	
	$css_combine= "";
	$created= [];
	
	foreach($filesCSS as $file){
		$path= parse_url($file)['path'];
		$created[]= basename(__DIR__).'/css'.$path;
		
		if( !is_dir(__DIR__."/css/".dirname($path)) ) mkdir(__DIR__."/css/".dirname($path), 0755, true);
		$path= __DIR__."/css".$path;
		
		$sSource= file_get_contents($file);
		$oParser= new Sabberworm\CSS\Parser($sSource);
		$oCss= $oParser->parse();
		
		
		file_put_contents( 
			$path.'orig',
			$oCss->render(Sabberworm\CSS\OutputFormat::createPretty())
		);
		
		removeSelectors($oCss);
		
		file_put_contents( 
			$path,
			$oCss->render(Sabberworm\CSS\OutputFormat::createPretty())
		);
		


		
		
		$css_combine.= $oCss->render(Sabberworm\CSS\OutputFormat::createCompact());
	}

	
	$created[]= basename(__DIR__).'/css/css_combine.min.css';
	file_put_contents(__DIR__.'/css/css_combine.min.css', $css_combine);
	
	die(json_encode(['status'=> 'generate', 'created'=> $created ]));
}





function diffRules($arr, $search){ // Проверка массива
	foreach($arr as $k=>$v){
		if( isset($search[$k]) && $search[$k] == $v ){
			continue;
		} else {
			return false;
		}
	}
	return true;
}




function removeSelectors($oList) { // Удаление пустых и неиспользуемых селекторов
	global $all_unused;
	
	foreach ($oList->getContents() as $oBlock) {
		if($oBlock instanceof Sabberworm\CSS\RuleSet\DeclarationBlock) {
			if ( empty($oBlock->getRules()) ) {
				$oList->remove( $oBlock );
			} else {
				foreach($oBlock->getSelectors() as $oSelector) {
					//Loop over all selector parts (the comma-separated strings in a selector) and prepend the id
					$selector= preg_replace('/[\s]{2,}/', ' ', $oSelector->getSelector() );
					
					$delete= false;
					$isPresent= array_filter($all_unused, fn($v) => in_array($selector, $v) );
					if(is_array($isPresent) && count($isPresent) > 0) $delete= true;
					
					if($delete){ // Добавить проверку есть ли этот файл стиля на странице
						foreach($all_unused as $page){
							if( !in_array($selector, $page) ){
								$delete= false;
								break;
							}
						}
					}
					
					if($delete){
						$oList->remove($oBlock);
					}
				}
			}
		} else if($oBlock instanceof Sabberworm\CSS\CSSList\CSSBlockList) {
			removeSelectors($oBlock);
			if (empty($oBlock->getContents())) {
				$oList->remove($oBlock);
			}
		}
	}
}


?>
