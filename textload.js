let TextLoad = (function() {
	let TextLoad = {};
	
	let loadedFileCache = new Map();
	let requestCount = 0;
	let callbacks = [];
	
	function textToArray(text) {
		return text.split(/[\n\r]+/);	
	}

	TextLoad.load = function(url, callback) {
		requestCount++;
		
		let request = new XMLHttpRequest();
		
		request.addEventListener("load", function(e) { onLoad(e, url, callback) });
		request.addEventListener("error", function(e) { onError(e, url, callback) });
		request.addEventListener("abort", function(e) { onError(e, url, callback) });
		
		request.open("GET", url);
		request.overrideMimeType("text/plain");
		
		request.send();
	}
	
	TextLoad.massLoad = function(data) {
		// Each request must retain its own key until its asynchronous response
		// arrives. A shared iterator would make every callback write to the
		// final key in the collection.
		for (let key in data) {
			TextLoad.load(data[key], function(result) {
				data[key] = result;
			});
		}
	}

	function onLoad(event, url, callback) {
		let data = textToArray(event.target.responseText);
		if (callback) { callback(data) };
		
		onLoadEnd();
	}
	
	function onError(event, url, callback) {
		if (callback) { callback([]) };
		console.warn('Could not load text file: ' + url);
		
		onLoadEnd();
	}
	
	function onLoadEnd() {
		requestCount--;
		
		if (requestCount <= 0) {
			// Detach the completed batch before invoking it. A completion callback
			// may start another load cycle and register a new onAllLoad callback;
			// resetting these shared values after the callbacks would erase it.
			requestCount = 0;
			let completedCallbacks = callbacks;
			callbacks = [];
			
			for (let callback of completedCallbacks) {
				callback();
			}
		}
	}

	TextLoad.onAllLoad = function(callback) {
		if (requestCount == 0) {
			callback();
			return;
		}
		
		callbacks.push(callback);
	}
	
	return TextLoad;
}) ();