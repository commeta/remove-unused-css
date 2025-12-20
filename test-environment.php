<?php
/**
 * Тестовое окружение для Remove Unused CSS
 * 
 * Генерирует страницы с различными комбинациями CSS правил
 * для тестирования обнаружения используемых/неиспользуемых селекторов
 */

// Конфигурация
define('TEST_PAGES', [
    'home' => [
        'title' => 'Главная страница',
        'classes' => ['header', 'nav', 'hero', 'content', 'footer'],
        'ids' => ['main-header', 'primary-nav', 'hero-section'],
        'tags' => ['h1', 'p', 'a', 'button', 'div'],
        'description' => 'Основная страница с базовыми элементами'
    ],
    'about' => [
        'title' => 'О нас',
        'classes' => ['header', 'nav', 'about-section', 'team', 'content', 'footer'],
        'ids' => ['main-header', 'about-content', 'team-section'],
        'tags' => ['h1', 'h2', 'p', 'div', 'img'],
        'description' => 'Страница о компании'
    ],
    'products' => [
        'title' => 'Продукты',
        'classes' => ['header', 'nav', 'products-grid', 'product-card', 'price', 'footer'],
        'ids' => ['main-header', 'products-container'],
        'tags' => ['h1', 'h3', 'div', 'span', 'button'],
        'description' => 'Каталог продуктов'
    ],
    'contact' => [
        'title' => 'Контакты',
        'classes' => ['header', 'nav', 'contact-form', 'form-group', 'footer'],
        'ids' => ['main-header', 'contact-section', 'contact-form'],
        'tags' => ['h1', 'form', 'input', 'textarea', 'button'],
        'description' => 'Форма обратной связи'
    ],
    'gallery' => [
        'title' => 'Галерея',
        'classes' => ['header', 'nav', 'gallery', 'gallery-item', 'lightbox', 'footer'],
        'ids' => ['main-header', 'gallery-grid'],
        'tags' => ['h1', 'div', 'img', 'a'],
        'description' => 'Галерея изображений'
    ],
    'blog' => [
        'title' => 'Блог',
        'classes' => ['header', 'nav', 'blog-post', 'post-meta', 'comments', 'footer'],
        'ids' => ['main-header', 'blog-container', 'comments-section'],
        'tags' => ['h1', 'h2', 'article', 'p', 'time'],
        'description' => 'Блог статей'
    ],
    '404' => [
        'title' => 'Страница не найдена',
        'classes' => ['error-page', 'error-404'],
        'ids' => ['error-container'],
        'tags' => ['h1', 'p', 'a'],
        'description' => 'Страница ошибки 404'
    ]
]);

// Получаем текущую страницу из GET параметра
$currentPage = $_GET['page'] ?? 'home';
$currentPage = array_key_exists($currentPage, TEST_PAGES) ? $currentPage : '404';
$pageConfig = TEST_PAGES[$currentPage];

// Функция генерации навигационного меню
function generateNavigation($currentPage)
{
    $nav = '<nav id="primary-nav" class="nav">';
    $nav .= '<ul class="nav-list">';

    foreach (TEST_PAGES as $key => $page) {
        if ($key === '404')
            continue;
        $active = $key === $currentPage ? ' class="active"' : '';
        $nav .= sprintf(
            '<li%s><a href="?page=%s">%s</a></li>',
            $active,
            $key,
            $page['title']
        );
    }

    $nav .= '</ul></nav>';
    return $nav;
}

// Функция генерации контента страницы
function generatePageContent($pageConfig, $pageName)
{
    $content = '<div class="content">';

    switch ($pageName) {
        case 'home':
            $content .= '<section id="hero-section" class="hero">';
            $content .= '<h1 class="hero-title">Добро пожаловать на тестовую страницу</h1>';
            $content .= '<p class="hero-subtitle">Система тестирования Remove Unused CSS</p>';
            $content .= '<button class="btn btn-primary">Начать тестирование</button>';
            $content .= '</section>';
            break;

        case 'about':
            $content .= '<section id="about-content" class="about-section">';
            $content .= '<h1>О проекте</h1>';
            $content .= '<p class="lead">Тестовое окружение для проверки работы системы.</p>';
            $content .= '<div id="team-section" class="team">';
            $content .= '<h2>Команда</h2>';
            $content .= '<div class="team-member"><img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'100\' height=\'100\'%3E%3Crect fill=\'%23ddd\' width=\'100\' height=\'100\'/%3E%3C/svg%3E" alt="Team"></div>';
            $content .= '</div>';
            $content .= '</section>';
            break;

        case 'products':
            $content .= '<section id="products-container" class="products-section">';
            $content .= '<h1>Наши продукты</h1>';
            $content .= '<div class="products-grid">';
            for ($i = 1; $i <= 6; $i++) {
                $content .= '<div class="product-card">';
                $content .= '<h3>Продукт ' . $i . '</h3>';
                $content .= '<span class="price">$99.99</span>';
                $content .= '<button class="btn btn-buy">Купить</button>';
                $content .= '</div>';
            }
            $content .= '</div>';
            $content .= '</section>';
            break;

        case 'contact':
            $content .= '<section id="contact-section" class="contact-section">';
            $content .= '<h1>Свяжитесь с нами</h1>';
            $content .= '<form id="contact-form" class="contact-form">';
            $content .= '<div class="form-group"><input type="text" placeholder="Имя" class="form-control"></div>';
            $content .= '<div class="form-group"><input type="email" placeholder="Email" class="form-control"></div>';
            $content .= '<div class="form-group"><textarea placeholder="Сообщение" class="form-control"></textarea></div>';
            $content .= '<button type="submit" class="btn btn-submit">Отправить</button>';
            $content .= '</form>';
            $content .= '</section>';
            break;

        case 'gallery':
            $content .= '<section id="gallery-grid" class="gallery-section">';
            $content .= '<h1>Галерея</h1>';
            $content .= '<div class="gallery">';
            for ($i = 1; $i <= 9; $i++) {
                $content .= '<div class="gallery-item">';
                $content .= '<img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'300\' height=\'200\'%3E%3Crect fill=\'%23' . dechex(rand(0, 16777215)) . '\' width=\'300\' height=\'200\'/%3E%3C/svg%3E" alt="Image ' . $i . '">';
                $content .= '</div>';
            }
            $content .= '</div>';
            $content .= '</section>';
            break;

        case 'blog':
            $content .= '<section id="blog-container" class="blog-section">';
            $content .= '<h1>Блог</h1>';
            for ($i = 1; $i <= 3; $i++) {
                $content .= '<article class="blog-post">';
                $content .= '<h2>Заголовок статьи ' . $i . '</h2>';
                $content .= '<div class="post-meta"><time>2025-01-' . sprintf('%02d', $i) . '</time></div>';
                $content .= '<p>Текст статьи...</p>';
                $content .= '</article>';
            }
            $content .= '<div id="comments-section" class="comments"><h3>Комментарии</h3></div>';
            $content .= '</section>';
            break;

        case '404':
            $content .= '<section id="error-container" class="error-page error-404">';
            $content .= '<h1>404</h1>';
            $content .= '<p>Страница не найдена</p>';
            $content .= '<a href="?page=home" class="btn">На главную</a>';
            $content .= '</section>';
            break;
    }

    $content .= '</div>';
    return $content;
}

// Генерация списка тестовых ссылок
function generateTestLinks()
{
    $html = '<div class="test-links">';
    $html .= '<h3>Тестовые страницы:</h3>';
    $html .= '<ul>';

    foreach (TEST_PAGES as $key => $page) {
        $html .= sprintf(
            '<li><a href="?page=%s">%s</a> - <small>%s</small></li>',
            $key,
            $page['title'],
            $page['description']
        );
    }

    $html .= '</ul>';
    $html .= '</div>';
    return $html;
}

?>
<!DOCTYPE html>
<html lang="ru">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= htmlspecialchars($pageConfig['title']) ?> - Test Environment</title>
    <link rel="stylesheet" href="test-style.css">
    <style>
        /* Inline CSS для неизменных правил */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        /* Статистика страницы */
        .page-stats {
            position: fixed;
            top: 10px;
            right: 10px;
            background: white;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            font-size: 12px;
            z-index: 1000;
        }

        .page-stats h4 {
            margin-bottom: 10px;
            color: #2c3e50;
        }

        .page-stats ul {
            list-style: none;
        }

        .page-stats li {
            padding: 3px 0;
        }

        .page-stats .count {
            font-weight: bold;
            color: #3498db;
        }
    </style>

    <!-- Подключение Remove Unused CSS -->
    <script src="remove-unused-css.js"></script>
</head>

<body>
    <!-- Статистика страницы -->
    <div class="page-stats">
        <h4>📊 Статистика страницы</h4>
        <ul>
            <li>Страница: <span class="count"><?= htmlspecialchars($pageConfig['title']) ?></span></li>
            <li>Классов: <span class="count"><?= count($pageConfig['classes']) ?></span></li>
            <li>ID: <span class="count"><?= count($pageConfig['ids']) ?></span></li>
            <li>Тегов: <span class="count"><?= count($pageConfig['tags']) ?></span></li>
        </ul>
    </div>

    <div class="container">
        <!-- Заголовок -->
        <header id="main-header" class="header">
            <div class="logo">Test Environment</div>
            <?= generateNavigation($currentPage) ?>
        </header>

        <!-- Основной контент -->
        <main>
            <?= generatePageContent($pageConfig, $currentPage) ?>
        </main>

        <!-- Список тестовых ссылок -->
        <?= generateTestLinks() ?>

        <!-- Футер -->
        <footer class="footer">
            <p>&copy; 2025 Test Environment for Remove Unused CSS</p>
            <p><small>Current page: <strong><?= htmlspecialchars($currentPage) ?></strong></small></p>
        </footer>
    </div>
</body>

</html>
