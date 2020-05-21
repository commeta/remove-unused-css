/*!
 * Remove unused CSS
 * https://github.com/commeta/remove-unused-css
 * Copyright 2020 Commeta
 * Released under the GPL v3 or MIT license
 * 
 * eslint-disable no-var,no-console
 * fork: Detect unused CSS selectors Copyright Victor Homyakov
 * https://gist.github.com/victor-homyakov/aefd2ed05a050b1068c667d829a17419
 */

(function() {
    var parsedRules = parseCssRules();
    console.log('Parsed CSS rules:', parsedRules);
    detectDuplicateSelectors(parsedRules);

    var selectorsToTrack = getSelectorsToTrack(parsedRules);
    window.selectorStats = { unused: [], added: [], removed: [] };
    console.log('Tracking style usage (inspect window.selectorStats for details)...');

    setInterval(function() {
        var newSelectors = getSelectorsToTrack(parseCssRules());

        // Calculation order for removed/added/unused is significant
        var removed = Object.keys(selectorsToTrack)
            .filter(selector => newSelectors[selector] === undefined);

        var added = Object.keys(newSelectors)
            .filter(selector => {
                if (selectorsToTrack[selector] === undefined) {
                    selectorsToTrack[selector] = 0;
                    return true;
                }
                return false;
            });

        var unused = Object.keys(selectorsToTrack)
            .filter(selector => {
                if (document.querySelector(selector)) {
                    selectorsToTrack[selector]++;
                }
                return selectorsToTrack[selector] === 0;
            });

        var message = [];
        if (unused.length !== window.selectorStats.unused.length) {
            message.push(unused.length + ' unused');
        }
        window.selectorStats.unused = unused;
        if (added.length > 0) {
            message.push(added.length + ' added');
            window.selectorStats.added = added;
        }
        if (removed.length > 0) {
            message.push(removed.length + ' removed', removed);
            window.selectorStats.removed = removed;
        }

        if (message.length > 0) {
            console.log('Selectors: ' + message.join(', '));
        }
    }, 1000);

    function parseCssRules() {
        var styleSheets = document.styleSheets,
            parsedRules = {
                fontFaces: [],
                keyframes: [],
                media: [],
                style: [],
                support: [],
                unknown: []
            };

        for (var i = 0; i < styleSheets.length; i++) {
            var styleSheet = styleSheets[i];
            var rules;

            try {
                rules = styleSheet.cssRules; // styleSheet.rules
            } catch (e) {
                if (styleSheet.ignored) {
                    continue;
                }

                console.log(e.name + ' while accessing style sheet', styleSheet.ownerNode);
                styleSheet.ignored = true;

                if (e.name === 'SecurityError') {
                    // Security error when accessing cross-origin style sheet.
                    // Possible workaround if we want to analyze content: fetch styleSheet.href
                    // (will anyways have problems with relative urls and @import).
                    // https://discourse.mozilla.org/t/webextensions-porting-access-to-cross-origin-document-stylesheets-cssrules/18359
                    // Appended style sheet will be discovered in the next iteration
                    loadStyleSheet(styleSheet.href, styleSheet.ownerNode);
                }

                continue;
            }

            for (var j = 0; j < rules.length; j++) {
                var rule = rules[j];
                var ruleClass = Object.prototype.toString.call(rule).replace(/\[object (.+)]/, '$1');

                switch (ruleClass) {
                    case 'CSSFontFaceRule':
                        parsedRules.fontFaces.push(rule.cssText);
                        break;
                    case 'CSSKeyframesRule':
                        parsedRules.keyframes.push(rule.cssText);
                        break;
                    case 'CSSMediaRule':
                        // if (rule.conditionText)
                        parsedRules.media.push(rule.conditionText);
                        break;
                    case 'CSSStyleRule':
                        // if (rule.selectorText)
                        parsedRules.style.push(rule.selectorText);
                        // rule.cssText
                        break;
                    case 'CSSSupportsRule':
                        parsedRules.support.push(rule.conditionText);
                        break;
                    default:
                        parsedRules.unknown.push(rule);
                }
            }
        }

        return parsedRules;
    }

    function loadStyleSheet(href, node) {
        // node.parentNode.removeChild(node);
        fetch(href).then(response => response.text()).then(css => {
            var style = document.createElement('style');
            // style.innerText = css; inserts line breaks as `<br>`
            style.innerHTML = css;
            // Insert before the original style sheet.
            // This way broken relative URLs will be fixed by the original rules.
            node.parentNode.insertBefore(style, node);
        });
    }

    function detectDuplicateSelectors(parsedRules) {
        var seenSelectors = {},
            duplicatedSelectors = [],
            duplicatedSequence = [];

        parsedRules.style.forEach(function(selector) {
            if (selector in seenSelectors) {
                duplicatedSelectors.push(selector);
                duplicatedSequence.push(selector);
            } else {
                seenSelectors[selector] = true;
                if (duplicatedSequence.length > 5) {
                    console.warn('Duplicated sequence of selectors:', duplicatedSequence);
                }
                duplicatedSequence = [];
            }
        });

        if (duplicatedSelectors.length > 0) {
            console.log('List of all duplicated selectors:', duplicatedSelectors);
        }
    }

    function getSelectorsToTrack(parsedRules) {
        return parsedRules.style
            .filter(function(selector) {
                return !(
                    selector === 'html' ||
                    selector.includes(':hover') ||
                    selector.includes('::after') ||
                    selector.includes('::before')
                );
            })
            .reduce(function(selectors, selector) {
                selectors[selector] = 0;
                return selectors;
            }, {});
    }
}());

