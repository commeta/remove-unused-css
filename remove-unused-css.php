<?php
/*
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2020 Commeta
 * Released under the GPL v3 or MIT license
 * 
 * Use forked library PHP CSS Parser
 * https://github.com/sabberworm/PHP-CSS-Parser
 * 
 */
 
header('Content-type: application/json');
if(!isset($_POST['json'])) die(json_encode([]));
$json= json_decode($_POST['json'], true);


if($json['mode'] == 'auto' || $json['mode'] == 'save'){
	////////////////////////////////////////////////////////////////////////
	// Массив файлов css, накопитель
	
	
	////////////////////////////////////////////////////////////////////////
	// Массив неиспользуемых правил, накопитель


	////////////////////////////////////////////////////////////////////////
	// Массив ссылок для обхода страниц
	if( file_exists(__DIR__."/links") ) { 
		$links= array_merge( unserialize( file_get_contents(__DIR__."/links") ), $json['links'] );
	} else {
		$links= $json['links'];
	}

	$links= array_unique($links);
	file_put_contents( __DIR__."/links", serialize($links) );


	////////////////////////////////////////////////////////////////////////
	// Массив уже обойденных страниц
	if( file_exists(__DIR__."/visited") ) { 
		$visited= unserialize( file_get_contents(__DIR__."/visited") );
	} else {
		$visited= [];
	}

	$visited[]= $json['pathname'];
	file_put_contents( __DIR__."/visited", serialize($visited) );


	if($json['mode'] == 'auto'){
		foreach($links as $link){ // Посылаем в браузер следующую ссылку
			if( !in_array($link, $visited) ){
				die(json_encode(['status'=> 'ok', 'location' => $link]));
			}
		}
	}
	
	die(json_encode(['status'=> 'complete', 'unused_length'=> count($json['unused']) ]));
}



if($json['mode'] == 'generate'){ // Создаем новые CSS файлы, без неиспользуемых стилей
	spl_autoload_register(function($class){
		$file = __DIR__.'/lib/'.strtr($class, '\\', '/').'.php';
		if (file_exists($file)) {
			require $file;
			return true;
		}
	});

	$sSource = file_get_contents('../style.css');
	$oParser = new Sabberworm\CSS\Parser($sSource);
	$oCss = $oParser->parse();
	removeSelectors($oCss);
	
	print $oCss->render(Sabberworm\CSS\OutputFormat::createPretty());
	//print $oCss->render(Sabberworm\CSS\OutputFormat::createCompact());
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

function removeSelectors($oList) {
    foreach ($oList->getContents() as $oBlock) {
        if ($oBlock instanceof Sabberworm\CSS\RuleSet\DeclarationBlock) {
			
            if ( empty ( $oBlock->getRules() ) ) {
                $oList->remove( $oBlock );
            } else {
				foreach($oBlock->getSelectors() as $oSelector) {
					//Loop over all selector parts (the comma-separated strings in a selector) and prepend the id
					
					$selector= preg_replace('/[\s]{2,}/', ' ', $oSelector->getSelector() );
					// print_r( [ $selector ] );
					
					if( $oSelector->getSelector() == 'code' ){
						$oList->remove( $oBlock );
					}
				}
				
			}
        } else if ($oBlock instanceof Sabberworm\CSS\CSSList\CSSBlockList) {
            removeSelectors($oBlock);
            if (empty($oBlock->getContents())) {
                $oList->remove($oBlock);
            }
        }
    }
}


?>
