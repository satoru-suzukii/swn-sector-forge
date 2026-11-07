let DynEdit = {};

DynEdit.edit = function(title, object, template=null, callback=null) {
	let modal = DynModal.show();
	let parentElem = document.createElement('div');
	parentElem.className = 'dynedit';
	modal.container.appendChild(parentElem);
	let data = {};

	simpleAppend(parentElem, 'p', title, 'dynedit-title');
	let buttonRowElem = simpleAppend(parentElem, 'p');
	let randomizeAllButton = simpleAppend(buttonRowElem, 'button', '(Randomize All)', 'textbutton dynedit-toolbar-button');
	randomizeAllButton.type = 'button';
	randomizeAllButton.addEventListener('click', onRandomizeAll);
	appendText(buttonRowElem, ' ');
	let revertAllButton = simpleAppend(buttonRowElem, 'button', '(Revert All)', 'textbutton dynedit-toolbar-button');
	revertAllButton.type = 'button';
	revertAllButton.addEventListener('click', onRevertAll);

	let tableElem = simpleAppend(parentElem, 'table');

	// Opening an editor is deliberately read-only. The live record is changed only
	// after Save, and the opening values are retained as a true Revert snapshot.
	for (let property in object) {
		let value = object[property];
		if (template && Array.isArray(template.hide) && template.hide.indexOf(property) >= 0) continue;
		if (!(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) continue;

		let propertyData = {originalValue:value, inputElem:null, generator:null, type:typeof value};
		data[property] = propertyData;
		let rowElem = document.createElement('div');
		let inputElem = null;
		let list = template && template.lists && template.lists[property];
		if (Array.isArray(list)) {
			inputElem = simpleAppend(rowElem, 'select');
			list = GenUtil && typeof GenUtil.unique === 'function' ? GenUtil.unique(list) : Array.from(new Set(list));
			list.forEach(function(item) {
				let optionElem = document.createElement('option');
				optionElem.text = optionElem.value = String(item == null ? '' : item);
				inputElem.add(optionElem);
			});
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
		if (!inputElem) {
			inputElem = simpleAppend(rowElem, typeof value === 'string' ? 'textarea' : 'input');
			if (typeof value === 'number') inputElem.type = 'number';
			if (typeof value === 'boolean') inputElem.type = 'checkbox';
		}
		setInputValue(inputElem, value, propertyData.type);
		propertyData.inputElem = inputElem;

		let randomizeButton = null;
		let generator = template && template.generators && template.generators[property];
		if (typeof generator === 'function') {
			propertyData.generator = generator;
			randomizeButton = simpleAppend(rowElem, 'button', '↺', 'dynedit-randomize');
			randomizeButton.type = 'button';
			randomizeButton.title = 'Randomize ' + property;
			randomizeButton.setAttribute('aria-label', 'Randomize ' + property);
			randomizeButton.addEventListener('click', function(event) {
				event.preventDefault();
				randomizeProperty(property, true);
			});
		}

		let revertButton = simpleAppend(rowElem, 'button', '↩', 'dynedit-randomize dynedit-revert');
		revertButton.type = 'button';
		revertButton.title = 'Revert ' + property + ' to its value when this editor was opened';
		revertButton.setAttribute('aria-label', 'Revert ' + property);
		revertButton.addEventListener('click', function(event) {
			event.preventDefault();
			setInputValue(inputElem, propertyData.originalValue, propertyData.type);
		});
		appendRow(tableElem, [property + ':', inputElem, randomizeButton || '', revertButton]);
	}

	buttonRowElem = simpleAppend(parentElem, 'p');
	let saveButton = simpleAppend(buttonRowElem, 'button', '(Save)', 'textbutton dynedit-toolbar-button');
	saveButton.type = 'button';
	saveButton.addEventListener('click', onSave);
	appendText(buttonRowElem, ' ');
	let cancelButton = simpleAppend(buttonRowElem, 'button', '(Cancel)', 'textbutton dynedit-toolbar-button');
	cancelButton.type = 'button';
	cancelButton.addEventListener('click', onCancel);

	function readInputValue(inputElement, type, originalValue) {
		if (type === 'boolean') return !!inputElement.checked;
		if (type === 'number') return inputElement.value === '' ? originalValue : Number(inputElement.value);
		return inputElement.value;
	}

	function setInputValue(inputElement, value, type) {
		if (type === 'boolean') inputElement.checked = !!value;
		else inputElement.value = value == null ? '' : String(value);
	}

	function currentObject() {
		let draft = {};
		for (let key in object) draft[key] = object[key];
		for (let key in data) {
			let item = data[key];
			if (item && item.inputElem) draft[key] = readInputValue(item.inputElem, item.type, item.originalValue);
		}
		return draft;
	}

	function randomizeProperty(property, retryForDifference) {
		let item = data[property];
		if (!item || typeof item.generator !== 'function') return false;
		let before = readInputValue(item.inputElem, item.type, item.originalValue);
		let result = before;
		let attempts = retryForDifference ? 12 : 1;
		try {
			while (attempts-- > 0) {
				result = item.generator(currentObject());
				if (item.type === 'number') result = Number(result);
				if (item.type === 'boolean') result = !!result;
				if (item.type === 'string') result = result == null ? '' : String(result);
				if (result !== before) break;
			}
			if (item.type === 'number' && !Number.isFinite(result)) return false;
			if (item.inputElem.tagName === 'SELECT') {
				let optionExists = Array.prototype.some.call(item.inputElem.options, function(option) { return option.value === String(result); });
				if (!optionExists) {
					let option = document.createElement('option');
					option.value = String(result);
					option.text = String(result);
					item.inputElem.add(option);
				}
			}
			setInputValue(item.inputElem, result, item.type);
			return result !== before;
		} catch (error) {
			console.error('Randomizer failed for ' + property + ':', error);
			return false;
		}
	}

	function onRandomizeAll() {
		// Work from the live draft after every change so dependent generators (for
		// example, gravity after population) see the values generated just before them.
		let properties = Object.keys(data);
		if (data.population && data.gravity) {
			properties = properties.filter(function(key) { return key !== 'population' && key !== 'gravity'; });
			properties.unshift('population');
			properties.push('gravity');
		}
		if (data.maxHitPoints && data.hitPoints) {
			properties = properties.filter(function(key) { return key !== 'maxHitPoints' && key !== 'hitPoints'; });
			properties.push('maxHitPoints');
			properties.push('hitPoints');
		}
		properties.forEach(function(property) { randomizeProperty(property, false); });
	}

	function onRevertAll() {
		Object.keys(data).forEach(function(property) {
			let item = data[property];
			setInputValue(item.inputElem, item.originalValue, item.type);
		});
	}

	function onSave() {
		let draft = currentObject();
		for (let key in data) {
			let item = data[key];
			let value = draft[key];
			if (item.type === 'number') {
				if (value === '' || value === null || value === undefined || !Number.isFinite(Number(value))) value = item.originalValue;
				else value = Number(value);
			}
			if (item.type === 'boolean') value = !!value;
			draft[key] = value;
		}
		DynModal.hide(modal);
		if (callback) {
			for (let commitKey in data) object[commitKey] = draft[commitKey];
			callback(true);
		}
	}

	function onCancel() {
		DynModal.hide(modal);
		if (callback) callback(false);
	}

	function simpleAppend(parent, tag, text='', classes='') {
		let element = document.createElement(tag);
		if (tag === 'textarea' || tag === 'input' || tag === 'select' || tag === 'button') {
			if (tag === 'button') element.textContent = text;
		} else element.innerText = text;
		element.className = classes;
		parent.appendChild(element);
		return element;
	}
	function appendText(parent, content) { parent.appendChild(document.createTextNode(content)); }
	function appendRow(table, cells) {
		let row = document.createElement('tr');
		cells.forEach(function(cell) {
			let td = document.createElement('td');
			if (typeof cell === 'string') td.textContent = cell;
			else if (cell) td.appendChild(cell);
			row.appendChild(td);
		});
		table.appendChild(row);
		return row;
	}
};
