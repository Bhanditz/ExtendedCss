/**
 * Copyright 2016 Adguard Software Ltd
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* global utils, CSSRule */

/**
 * `:properties(propertyFilter)` pseudo class support works by looking up
 * selectors that are applied to styles whose style declaration matches
 * arguments passed to the pseudo class.
 * `sheetToFilterSelectorMap` contains a data mapping (stylesheets, filter)
 * -> selector.
 */
var StyleObserver = function () {
    // jshint ignore:line

    // Utility functions
    var styleSelector = 'style';

    /**
     * A set of stylesheet nodes that should be ignored by the StyleObserver.
     * This field is essential in the case of AdGuard products that add regular stylesheets
     * in order to apply CSS rules
     *
     * @type {Set.<HTMLElement>}
     */
    var ignoredStyleNodes = void 0;

    /**
     * The flag is used for the StyleObserver lazy initialization
     */
    var initialized = false;

    var searchTree = function (node, selector) {
        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        var nodes = node.querySelectorAll(selector);
        if (node[utils.matchesPropertyName](selector)) {
            nodes = Array.prototype.slice.call(nodes);
            nodes.push(node);
        }
        return nodes;
    };

    var isSameOriginStyle = function (styleSheet) {
        var href = styleSheet.href;
        if (href === null) {
            return true;
        }
        return utils.isSameOrigin(href, location, document.domain);
    };

    /**
     * 'rel' attribute is a ASCII-whitespace separated list of keywords.
     * {@link https://html.spec.whatwg.org/multipage/links.html#linkTypes}
     */
    var reStylesheetRel = /(?:^|\s)stylesheet(?:$|\s)/;

    var eventTargetIsLinkStylesheet = function (target) {
        return target instanceof Element && target.nodeName === 'LINK' && reStylesheetRel.test(target.rel);
    };

    // Functions constituting mutation handler functions
    var onStyleAdd = function (style) {
        if (!sheetToFilterSelectorMap.has(style.sheet)) {
            pendingStyles.add(style);
            observeStyleModification(style);
        }
    };
    var onStyleRemove = function (style) {
        pendingStyles.delete(style);
    };
    var onAddedNode = function (addedNode) {
        if (addedNode.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        var styles = searchTree(addedNode, styleSelector);
        if (styles) {
            for (var _i = 0, _length = styles.length; _i < _length; _i++) {
                var style = styles[_i];
                onStyleAdd(style);
            }
        }
    };
    var onRemovedNode = function (removedNode) {
        if (removedNode.nodeType !== Node.ELEMENT_NODE) {
            return;
        }
        var styles = searchTree(removedNode, styleSelector);
        if (styles) {
            for (var _i2 = 0, _length2 = styles.length; _i2 < _length2; _i2++) {
                var style = styles[_i2];
                onStyleRemove(style);
            }
        }
    };

    // Mutation handler functions
    var styleModHandler = function (mutations) {
        if (mutations.length) {
            for (var _i3 = 0, _length3 = mutations.length; _i3 < _length3; _i3++) {
                var mutation = mutations[_i3];
                var target = void 0;
                if (mutation.type === 'characterData') {
                    target = mutation.target.parentNode;
                } else {
                    target = mutation.target;
                }
                pendingStyles.add(target);
            }

            examineStylesScheduler.run();
            invalidateScheduler.run();
        }
    };
    var styleModListenerFallback = function (event) {
        pendingStyles.add(event.target.parentNode);
        examineStylesScheduler.run();
        invalidateScheduler.run();
    };
    var styleAdditionHandler = function (mutations) {
        var hasPendingStyles = false;

        for (var _i4 = 0, _length4 = mutations.length; _i4 < _length4; _i4++) {
            var mutation = mutations[_i4];
            var addedNodes = mutation.addedNodes,
                removedNodes = mutation.removedNodes;
            if (addedNodes) {
                for (var _i5 = 0, _length5 = addedNodes.length; _i5 < _length5; _i5++) {
                    var addedNode = addedNodes[_i5];
                    hasPendingStyles = true;
                    onAddedNode(addedNode);
                }
            }
            if (removedNodes) {
                for (var _i6 = 0, _length6 = removedNodes.length; _i6 < _length6; _i6++) {
                    var removedNode = removedNodes[_i6];
                    onRemovedNode(removedNode);
                }
            }
        }

        if (hasPendingStyles) {
            examineStylesScheduler.run();
            invalidateScheduler.run();
        }
    };
    var styleAdditionListenerFallback = function (event) {
        onAddedNode(event.target);
        examineStylesScheduler.run();
        invalidateScheduler.run();
    };
    var styleRemovalListenerFallback = function (event) {
        onRemovedNode(event.target);
        examineStylesScheduler.run();
        invalidateScheduler.run();
    };

    var collectLoadedLinkStyle = function (evt) {
        var target = evt.target;
        if (!eventTargetIsLinkStylesheet(target)) {
            return;
        }
        pendingStyles.add(target);
        examineStylesScheduler.run();
    };
    var discardErroredLinkStyle = function (evt) {
        var target = evt.target;
        if (!eventTargetIsLinkStylesheet(target)) {
            return;
        }
        pendingStyles.remove(target);
        examineStylesScheduler.run();
    };

    // MutationObserver instances to be used in this class.
    // Since we start calling `.observe()` on those when we are compiling filters,
    // we can ensure that mutation callbacks for those will be called before those
    // in extended-css.js.
    var styleAdditionObserver = void 0;
    var styleModObserver = void 0;
    var observing = false;

    var observeStyle = function () {
        if (observing) {
            return;
        }
        observing = true;
        if (utils.MutationObserver) {
            styleAdditionObserver = new utils.MutationObserver(styleAdditionHandler);
            styleModObserver = new utils.MutationObserver(styleModHandler);
            styleAdditionObserver.observe(document.documentElement, { childList: true, subtree: true });
        } else {
            document.documentElement.addEventListener('DOMNodeInserted', styleAdditionListenerFallback);
            document.documentElement.addEventListener('DOMNodeRemoved', styleRemovalListenerFallback);
        }
        document.addEventListener('load', collectLoadedLinkStyle, true);
        document.addEventListener('error', discardErroredLinkStyle, true);
    };

    var observeStyleModification = function (styleNode) {
        if (utils.MutationObserver) {
            styleModObserver.observe(styleNode, { childList: true, subtree: true, characterData: true });
        } else {
            styleNode.addEventListener('DOMNodeInserted', styleModListenerFallback);
            styleNode.addEventListener('DOMNodeRemoved', styleModListenerFallback);
            styleNode.addEventListener('DOMCharacterDataModified', styleModListenerFallback);
        }
    };

    /**
     * Disconnects above mutation observers: styleAdditionObserver styleModObserver
     * and remove event listeners.
     */
    var disconnectObservers = function () {
        if (utils.MutationObserver) {
            if (styleAdditionObserver) {
                styleAdditionObserver.disconnect();
            }
            if (styleModObserver) {
                styleModObserver.disconnect();
            }
        } else {
            document.documentElement.removeEventListener('DOMNodeInserted', styleAdditionListenerFallback);
            document.documentElement.removeEventListener('DOMNodeRemoved', styleRemovalListenerFallback);

            var styles = document.querySelectorAll(styleSelector);

            for (var _i7 = 0, _length7 = styles.length; _i7 < _length7; _i7++) {
                var style = styles[_i7];
                style.removeEventListener('DOMNodeInserted', styleModListenerFallback);
                style.removeEventListener('DOMNodeRemoved', styleModListenerFallback);
                style.removeEventListener('DOMCharacterDataModified', styleModListenerFallback);
            }
        }
        document.removeEventListener('load', collectLoadedLinkStyle);
        document.removeEventListener('error', discardErroredLinkStyle);
        observing = false;
    };

    /**
     * @type {Set<HTMLStyleElement|HTMLLinkElement>}
     */
    var pendingStyles = new utils.Set();

    /**
     * sheetToFilterSelectorMap contains a data that maps
     * styleSheet -> ( filter -> selectors ).
     * @type {WeakMap<CSSStyleSheet,Object<string,string>>}
     */
    var sheetToFilterSelectorMap = void 0;

    var anyStyleWasUpdated = void 0; // A boolean flag to be accessed in `examineStyles`
    // and `readStyleSheetContent` calls.
    var examinePendingStyles = function () {
        anyStyleWasUpdated = false;
        pendingStyles.forEach(readStyleNodeContent);
        // Invalidates cache if needed.
        if (anyStyleWasUpdated) {
            invalidateScheduler.runImmediately();
        }
        pendingStyles.clear();
    };

    var examineStylesScheduler = new utils.AsyncWrapper(examinePendingStyles);

    /** @param {HTMLStyleElement} styleNode */
    var readStyleNodeContent = function (styleNode) {
        var sheet = styleNode.sheet;
        if (!sheet) {
            // This can happen when an appended style or a loaded linked stylesheet is
            // detached from the document by now.
            return;
        }
        readStyleSheetContent(sheet);
    };
    /**
     * Populates sheetToFilterSelectorMap from styleSheet's content.
     * @param {CSSStyleSheet} styleSheet
     */
    var readStyleSheetContent = function (styleSheet) {
        if (!isSameOriginStyle(styleSheet)) {
            return;
        }
        if (isIgnored(styleSheet.ownerNode)) {
            return;
        }
        var rules = styleSheet.cssRules;
        var map = Object.create(null);

        for (var _i8 = 0, _length8 = rules.length; _i8 < _length8; _i8++) {
            var rule = rules[_i8];
            if (rule.type !== CSSRule.STYLE_RULE) {
                /**
                 * Ignore media rules; this behavior is compatible with ABP.
                 * @todo Media query support
                 */
                continue;
            }
            var stringifiedStyle = stringifyStyle(rule);

            for (var _i9 = 0, _length9 = parsedFilters.length; _i9 < _length9; _i9++) {
                var parsedFilter = parsedFilters[_i9];
                var re = parsedFilter.re;

                if (!re.test(stringifiedStyle)) {
                    continue;
                }

                anyStyleWasUpdated = true;
                // Strips out psedo elements
                // https://adblockplus.org/en/filters#elemhide-emulation
                var selectorText = rule.selectorText.replace(/::(?:after|before)/, '');
                var filter = parsedFilter.filter;

                if (typeof map[filter] === 'undefined') {
                    map[filter] = [selectorText];
                } else {
                    map[filter].push(selectorText);
                }
            }
        }

        sheetToFilterSelectorMap.set(styleSheet, map);
    };

    /**
     * Stringifies a CSSRule instances in a canonical way, compatible with ABP,
     * to be used in matching against regexes.
     * @param {CSSStyleRule} rule
     * @return {string}
     */
    var stringifyStyle = function (rule) {
        var styles = [];
        var style = rule.style;
        var i = void 0,
            l = void 0;
        for (i = 0, l = style.length; i < l; i++) {
            styles.push(style[i]);
        }
        styles.sort();
        for (i = 0; i < l; i++) {
            var property = styles[i];
            var value = style.getPropertyValue(property);
            var priority = style.getPropertyPriority(property);
            styles[i] += ': ' + value;
            if (priority.length) {
                styles[i] += '!' + priority;
            }
        }
        return styles.join(" ");
    };

    /**
     * A main function, to be used in Sizzle matcher.
     * returns a selector text that is
     * @param {string} filter
     * @return {Array<string>} a selector.
     */
    var getSelector = function (filter) {

        // Lazy-initialize the StyleObserver
        initialize();

        // getSelector will be triggered via mutation observer callbacks
        // and we assume that those are already throttled.
        examineStylesScheduler.runImmediately();
        invalidateScheduler.runImmediately();
        invalidateScheduler.runAsap();

        if (getSelectorCache[filter]) {
            return getSelectorCache[filter];
        }
        var styleSheets = document.styleSheets;
        var selectors = [];

        for (var _i10 = 0, _length10 = styleSheets.length; _i10 < _length10; _i10++) {
            var styleSheet = styleSheets[_i10];
            if (styleSheet.disabled) {
                continue;
            } // Ignore disabled stylesheets.
            var map = sheetToFilterSelectorMap.get(styleSheet);
            if (typeof map === 'undefined') {
                // This can happen with cross-origin styles.
                continue;
            }
            Array.prototype.push.apply(selectors, map[filter]);
        }

        getSelectorCache[filter] = selectors;
        getSelectorCacheHasData = true;
        return selectors;
    };

    /**
     * Caching is based on following assumptions:
     *
     *  - Content of stylesheets does not change often.
     *  - Stylesheets' disabled state does not change often.
     *
     * For each fresh `getSelector` call, one has to iterate over document.styleSheets,
     * because one has to exclude disabled stylesheets.
     * getSelector will be called a lot in MutationObserver callbacks, and we assume that
     * stylesheets critical in `:properties` pseudo class are toggled on and off during it.
     * We use AsyncWrapper.runAsap to schedule cache invalidation in the most imminent
     * microtask queue.
     *
     * This requires thorough testing of StyleObserver for mutation-heavy environments.
     * This has a possibility of less granular cache refresh on IE, for IE11 incorrectly
     * implements microtasks and IE10's setImmediate is not that immediate.
     */
    var getSelectorCache = Object.create(null);
    var getSelectorCacheHasData = false;
    var invalidateCache = function () {
        if (getSelectorCacheHasData) {
            getSelectorCache = Object.create(null);
            getSelectorCacheHasData = false;
        }
    };
    var invalidateScheduler = new utils.AsyncWrapper(invalidateCache, 0);

    var reRegexRule = /^\/(.*)\/$/;

    var parsedFilters = [];
    var registeredFiltersMap = Object.create(null);

    var registerStylePropertyFilter = function (filter) {
        filter = filter.trim();
        if (registeredFiltersMap[filter]) {
            return;
        }
        var re = void 0;
        if (reRegexRule.test(filter)) {
            filter = filter.slice(1, -1);
            re = utils.pseudoArgToRegex(filter);
        } else {
            re = utils.createURLRegex(filter);
        }
        parsedFilters.push({
            filter: filter,
            re: re
        });
        registeredFiltersMap[filter] = true;

        /**
         * Mark StyleObserver as not initialized right after
         * the new property filter is registered
         */
        initialized = false;

        // It is also necessary to invalidate getSelectorCache right away
        invalidateCache();
    };

    /**
     * Initialization means:
     *
     *  - Initial processing of stylesheets in documents.
     *  - Starting to observe addition of styles.
     *
     * This function should be called only after all selectors are compiled.
     * @return {boolean} Whether it had to be initialized. If it returns false,
     * We can clear StyleObserver from the memory.
     */
    var initialize = function () {
        if (initialized) {
            return;
        }
        initialized = true;

        // If there is no `:properties` selector registered, indicates it
        // by returning false.
        if (parsedFilters.length === 0) {
            return false;
        }

        sheetToFilterSelectorMap = new utils.WeakMap();
        pendingStyles = new utils.Set();

        // Initial processing
        observeStyle();
        var sheets = document.styleSheets;

        for (var _i11 = 0, _length11 = sheets.length; _i11 < _length11; _i11++) {
            var sheet = sheets[_i11];
            readStyleSheetContent(sheet);
            if (sheet.ownerNode.nodeName === 'STYLE' && !isIgnored(sheet.ownerNode)) {
                observeStyleModification(sheet.ownerNode);
            }
        }

        return true;
    };

    /**
     * Exported method to disconnect existing mutation observers and remove
     * event listeners, clear collections and caches.
     */
    var clear = function () {
        if (!initialized) {
            return;
        }
        initialized = false;
        invalidateCache();
        disconnectObservers();
        if (pendingStyles) {
            pendingStyles.clear();
        }
        sheetToFilterSelectorMap = pendingStyles = ignoredStyleNodes = null;
    };

    /**
     * Creates a new pseudo-class and registers it in Sizzle
     */
    var extendSizzle = function (Sizzle) {
        Sizzle.selectors.pseudos["properties"] = Sizzle.selectors.pseudos["-abp-properties"] = Sizzle.selectors.createPseudo(function (propertyFilter) {
            registerStylePropertyFilter(propertyFilter);
            return function (element) {
                var selectors = getSelector(propertyFilter);
                if (selectors.length === 0) {
                    return false;
                }

                for (var _i12 = 0, _length12 = selectors.length; _i12 < _length12; _i12++) {
                    var selector = selectors[_i12];
                    if (element[utils.matchesPropertyName](selector)) {
                        return true;
                    }
                }

                return false;
            };
        });
    };

    /**
     * Checks if stylesheet node is in the list of ignored
     * @param {HTMLElement} styleNode Stylesheet owner node
     */
    var isIgnored = function (styleNode) {
        return ignoredStyleNodes && ignoredStyleNodes.has(styleNode);
    };

    /**
     * Sets a list of stylesheet nodes that must be ignored by the StyleObserver.
     *
     * @param {Array.<HTMLElement>} styleNodesToIgnore A list of stylesheet nodes. Can be empty or null.
     */
    var setIgnoredStyleNodes = function (styleNodesToIgnore) {

        // StyleObserver should be fully reinitialized after that
        if (initialized || observing) {
            clear();
        }

        if (styleNodesToIgnore) {
            ignoredStyleNodes = new utils.Set(styleNodesToIgnore);
        } else {
            ignoredStyleNodes = null;
        }
    };

    return {
        clear: clear,
        extendSizzle: extendSizzle,
        getSelector: getSelector,
        setIgnoredStyleNodes: setIgnoredStyleNodes
    };
}();