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
if( !is_dir(__DIR__."/data") ) mkdir(__DIR__."/data", 0770, true);

if($json['mode'] == 'auto' || $json['mode'] == 'save'){
	//if($_SERVER['REMOTE_ADDR'] != '127.0.0.1') die(json_encode([])); // Для запуска на продакшн, можно вписать свой ip


	////////////////////////////////////////////////////////////////////////
	// Массив неиспользуемых правил, по файлам
	if( file_exists($data."/filesCSS_unused") ) { 
		$filesCSS_unused= unserialize( file_get_contents($data."/filesCSS_unused") );
	} else {
		$filesCSS_unused= $json['filesCSS_unused'];
	}

	foreach($json['filesCSS_unused'] as $file=>$unused){ 
		if( !isset($filesCSS_unused[$file]) ) $filesCSS_unused[$file]= [];
		
		if(count($filesCSS_unused[$file]) == 0){
			$filesCSS_unused[$file]= $unused;
		}
		
		if( count($unused) < count($filesCSS_unused[$file]) ){// Тут нужен накопитель! bag!!!! тестируем
			$new_unused= $unused;
			
			foreach($filesCSS_unused[$file] as $rule){
				if( !in_array($rule, $unused) ) $new_unused[]= $rule;
			}
			
			$filesCSS_unused[$file]= $new_unused;
		} else {
			$new_unused= $filesCSS_unused[$file];
			
			foreach($unused as $rule){
				if( !in_array($rule, $filesCSS_unused[$file]) ) $new_unused[]= $rule;
			}
			
			$filesCSS_unused[$file]= $new_unused;
		}
	}

	
	file_put_contents( $data."/filesCSS_unused", serialize($filesCSS_unused) );


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
	// Массив уже обойденных страниц
	if( file_exists($data."/visited") ) { 
		$visited= unserialize( file_get_contents($data."/visited") );
	} else {
		$visited= [];
	}

	$visited[]= $json['pathname'];
	file_put_contents( $data."/visited", serialize($visited) );


	if($json['mode'] == 'auto'){
		foreach($links as $link){ // Посылаем в браузер следующую ссылку
			if( !in_array($link, $visited) ){
				die(json_encode(['status'=> 'ok', 'location' => $link]));
			}
		}
	}
	
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
	
	
	if( file_exists($data."/filesCSS_unused") ) { 
		$filesCSS_unused= unserialize( file_get_contents($data."/filesCSS_unused") );
	} else {
		$filesCSS_unused= [];
	}

	$css_combine= "";
	$created= [];
	
	$all_unused= [];
	foreach($filesCSS_unused as $file=>$unused){
		$all_unused= array_merge($all_unused, $unused);
	}
	
	foreach($filesCSS_unused as $file=>$unused){
		$path= parse_url($file)['path'];
		$created[]= basename(__DIR__).'/css'.$path;
		
		if( !is_dir(__DIR__."/css/".dirname($path)) ) mkdir(__DIR__."/css/".dirname($path), 0770, true);
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
				
					if( in_array($selector, $all_unused) ){
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
