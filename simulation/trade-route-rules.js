/*
 * Shared trade-route eligibility rules.
 * Keep one authoritative predicate for market links and simulation topology.
 */
var TradeRouteRules = (function() {
	'use strict';

	function isOperational(route) {
		if (!route || route.kind !== 'trade' || route.topologyStatus === 'Overextended') return false;
		return !/(closed|blocked|disrupted|suspended|inactive)/i.test(String(route.status || ''));
	}

	return {isOperational:isOperational};
})();
