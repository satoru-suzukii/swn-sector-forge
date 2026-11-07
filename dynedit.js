let DynEdit = {};

DynEdit.edit = function(title, object, template=null, callback=null) {
	let modal = DynModal.show();
	
	let parentElem = document.createElement('div');
	parentElem.className = 'dynedit';
	modal.container.appendChild(parentElem);
	
	let data = {};
	
	simpleAppend(parentElem, 'p', title, 'dynedit-title');
	
	let buttonRowElem = simpleAppend(parentElem, 'p');
	let randomizeAllButton = simpleAppend(buttonRowElem, 'span', '(Randomize All)', 'textbutton');
	randomizeAllButton.addEventListener('click', onRandomizeAll);
	appendText(buttonRowElem, ' ');
	let revertAllButton = simpleAppend(buttonRowElem, 'span', '(Revert All)', 'textbutton');
	revertAllButton.addEventListener('click', onRevertAll);
	
	let tableElem = simpleAppend(parentElem, 'table');
	
	// Opening an editor must be side-effect free: do not add default fields to the
	// live record until the user actually saves.
	for (var property in object) {
		let value = object[property];
		
		if (template && template.hide) {
			if (template.hide.indexOf(property) >= 0) {
				continue;
			}
		}
		
		if (!(typeof value == 'string' || typeof value == 'number' || typeof value == 'boolean')) {
			continue;
		}
		
		let propertyData = {
			originalValue:value,
			inputElem:null,
			generator:null,
			type:typeof value
		};
		data[property] = propertyData;
		
		let rowElem = simpleAppend(parentElem, 'p');
		let inputElem = null;
		
		if (template && template.lists) {
			let list = template.lists[property];
			if (list) {		
				inputElem = simpleAppend(rowElem, 'select');
				list = GenUtil.unique(list);
				
				for (let i = 0; i < list.length; i++) {
					let optionElem = document.createElement('option');
					optionElem.text = optionElem.value = String(list[i]);
					inputElem.add(optionElem);
				}
				// Imported values may be valid SWN terms that Forge's generation tables
				// do not use. Keep them as explicit options so an edit to another field
				// cannot silently replace them with an empty string.
				let existingValue = value == null ? '' : String(value);
				let hasExistingOption = Array.prototype.some.call(inputElem.options, function(option) { return option.value === existingValue; });
				if (!hasExistingOption) {
					let preservedOption = document.createElement('option');
					preservedOption.value = existingValue;
					preservedOption.text = existingValue ? existingValue + ' (existing value)' : '(blank)';
					preservedOption.setAttribute('data-preserved-existing-value', 'true');
					inputElem.add(preservedOption, inputElem.options.length ? inputElem.options[0] : null);
				}
			}
		}
		
		if (inputElem == null) {
			if (typeof value == 'string') {
				inputElem = simpleAppend(rowElem, 'textarea');
			} else {
				inputElem = simpleAppend(rowElem, 'input');
			}
			
			
			if (typeof value == 'number') {
				inputElem.type = 'number';
			}
			
			if (typeof value == 'boolean') {
				inputElem.type = 'checkbox'
				inputElem.checked = value;
			}
		}
		
		inputElem.value = value == null ? '' : value;
		propertyData.inputElem = inputElem;
		
		let randomizeButton = '';
		
		if (template && template.generators) {
			let generator = template.generators[property];
			if (generator) {
				propertyData.generator = generator;
				randomizeButton = simpleAppend(rowElem, 'span', '↺', 'dynedit-randomize');
				randomizeButton.title = 'randomize this value';
				
				function addRandomize(generatorFunction, inputElement) {
					randomizeButton.addEventListener('click', function(event) {
						let originalValue = inputElement.value;
						let value = originalValue;
						let count = 10;
						while (count > 0 && value == originalValue) {
							value = generatorFunction(currentObject());
						}
						inputElement.value = value;
					});
				}
				
				addRandomize(generator, inputElem);
			}
		}
		
		revertButton = simpleAppend(rowElem, 'span', '↩', 'dynedit-randomize');
		revertButton.title = 'revert this value';
		(function(originalValue, inputElement) {
			revertButton.addEventListener('click', function(event) {
				inputElement.value = originalValue;
			});
		})(propertyData.originalValue, inputElem);
		
		appendRow(tableElem, [property + ':' , inputElem, randomizeButton, revertButton]);
	}
	
	buttonRowElem = simpleAppend(parentElem, 'p');
	let saveButton = simpleAppend(buttonRowElem, 'span', '(Save)', 'textbutton');
	saveButton.addEventListener('click', onSave);
	appendText(buttonRowElem, ' ');
	let cancelButton = simpleAppend(buttonRowElem, 'span', '(Cancel)', 'textbutton');
	cancelButton.addEventListener('click', onCancel);
	
	/* ======================================================================== */
	
	function currentObject() {
		let draft = {};
		for (let key in object) draft[key] = object[key];
		for (let key in data) {
			let item = data[key];
			if (!item || !item.inputElem) continue;
			if (item.type === 'boolean') draft[key] = item.inputElem.checked;
			else if (item.type === 'number') draft[key] = item.inputElem.value === '' ? item.originalValue : Number(item.inputElem.value);
			else draft[key] = item.inputElem.value;
		}
		return draft;
	}

	function onRandomizeAll() {
		// Population determines the gravity envelope. Randomize it first and gravity
		// last so the editor's "Randomize All" action respects that dependency.
		let properties = Object.keys(data);
		if (data.population && data.gravity) {
			properties = properties.filter(function(key) { return key !== 'population' && key !== 'gravity'; });
			properties.unshift('population');
			properties.push('gravity');
		}
		for (let property of properties) {
			let propertyData = data[property];
			if (propertyData && propertyData.generator !== null) {
				propertyData.inputElem.value = propertyData.generator(currentObject());
			}
		}
	}

	function onRevertAll() {
		for (property in data) {
			let propertyData = data[property];
			propertyData.inputElem.value = propertyData.originalValue;
		}
	}
	
	function onSave() {
		// Build the complete draft first, then commit it. Hidden and nested fields
		// remain untouched; every visible primitive field retains its original
		// value unless the corresponding control was deliberately changed.
		let draft = currentObject();
		for (var key in data) {
			let propertyData = data[key];
			let value = draft[key];
			if (propertyData.type === 'number') {
				if (value === '' || value === null || value === undefined || !Number.isFinite(Number(value))) value = propertyData.originalValue;
				else value = Number(value);
			}
			if (propertyData.type === 'boolean') value = !!value;
			draft[key] = value;
		}
		DynModal.hide(modal);
		if (callback) {
			for (var commitKey in data) object[commitKey] = draft[commitKey];
			callback(true);
		}
	}
	
	function onCancel() {
		DynModal.hide(modal);
		if (callback) {
			callback(false);
		}
	}
	
	/* ======================================================================== */
	
	function simpleAppend(parent, tag, text='', classes='') {
		let element = document.createElement(tag);
		element.innerText = text;
		element.className = classes;
			
		parent.appendChild(element);
		
		return element;
	}
	
	function appendText(parentElem, content) {
		var textElem = document.createTextNode(content);
		parentElem.appendChild(textElem);
	}
	
	function appendRow(tableElem, rows) {
		let rowElem = simpleAppend(tableElem, 'tr');
		
		
		for (let i = 0; i < rows.length; i++) {
			if (typeof rows[i] == 'string') {
				simpleAppend(rowElem, 'td', rows[i]);
			} else {
				let cellElem = simpleAppend(rowElem, 'td');
				cellElem.appendChild(rows[i]);
			}
		}
		
		return rowElem;
	}
}