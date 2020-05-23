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

if($json['mode'] == 'auto' || $json['mode'] == 'save'){
	//if($_SERVER['REMOTE_ADDR'] != '127.0.0.1') die(json_encode([])); // Для запуска на продакшн, можно вписать свой ip
	
	if( file_exists($data."/data_file") ) { 
		$data_file= unserialize( file_get_contents($data."/data_file") );
	} else {
		$data_file= [];
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
	//if( !isset($data_file['filesCSS_page']) ){ 
		//$data_file['filesCSS_page']= [$json['pathname']=>$json['filesCSS']];
	//} 
	//$data_file['filesCSS_page'][$json['pathname']]= $json['filesCSS'];
	

	////////////////////////////////////////////////////////////////////////
	// Массив неиспользуемых правил, по страницам
	if( !isset($data_file['unused']) ){ 
		$data_file['unused']= [$json['pathname']=>$json['unused']];
	}
	
	if( isset($data_file['unused'][$json['pathname']]) ){
		if( count($data_file['unused'][$json['pathname']]) > count($json['unused']) ){
			$data_file['unused'][$json['pathname']]= $json['unused'];
		}
	} else {
		$data_file['unused'][$json['pathname']]= $json['unused'];
	}


	////////////////////////////////////////////////////////////////////////
	// Массив ссылок для обхода страниц
	if( isset($data_file['links']) ) {
		$data_file['links']= array_merge( $data_file['links'], $json['links'] );
	} else {
		$data_file['links']= $json['links'];
	}
	$data_file['links']= array_unique($data_file['links']);


	////////////////////////////////////////////////////////////////////////
	// Массив файлов no html
	if(!isset($data_file['no_html'])) { 
		$data_file['no_html']= [];
	} 
	
	
	////////////////////////////////////////////////////////////////////////
	// Массив уже обойденных страниц
	if( !isset($data_file['visited']) ) { 
		$data_file['visited']= [];
	} 
	$data_file['visited'][]= $json['pathname'];


	if($json['mode'] == 'auto'){
		foreach($data_file['links'] as $link){ // Посылаем в браузер следующую ссылку, если это html
			if( !in_array($link, $data_file['visited']) && !in_array($link, $data_file['no_html']) ){
				if( strpos( get_headers($json['host'].$link, 1)['Content-Type'], 'text/html') !== false  ){
					file_put_contents( $data."/data_file", serialize($data_file) );
					die(json_encode(['status'=> 'ok', 'location' => $link]));
				} else {
					$data_file['no_html'][]= $link;
				}
			}
		}
	}
	
	file_put_contents( $data."/data_file", serialize($data_file) );
	die(json_encode(['status'=> 'complete', 'unused_length'=> count($data_file['unused'][$json['pathname']]) ]));
}



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
		$all_unused= $data_file['unused'];
		$filesCSS= $data_file['filesCSS'];
	} else {
		die(json_encode(['status'=>'error']));
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
		
		removeSelectors($oCss);
		
		file_put_contents( 
			$path,
			$oCss->render(Sabberworm\CSS\OutputFormat::createPretty())
		);
		
		$css_combine.= $oCss->render(Sabberworm\CSS\OutputFormat::createCompact());
	}

	
	$created[]= basename(__DIR__).'/css/remove-unused-css.min.css';
	file_put_contents(__DIR__.'/css/remove-unused-css.min.css', $css_combine);
	
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
					
					if($delete){
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
