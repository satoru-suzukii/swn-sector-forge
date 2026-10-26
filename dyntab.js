function DynTab(parentElement) {
	this.parentElement = parentElement;

	this.tabElements = Array.from(parentElement.childNodes).filter(function(element) {
		return element.nodeType == Node.ELEMENT_NODE;
	});
	parentElement.innerHTML = '';

	this.headerElement = document.createElement('div');
	this.headerElement.className = 'dyntab-header';
	this.headerElement.setAttribute('role', 'tablist');
	this.headerElement.setAttribute('aria-label', 'Sector sections');
	this.bodyElement = document.createElement('div');
	this.bodyElement.className = 'dyntab-panels';

	parentElement.appendChild(this.headerElement);
	parentElement.appendChild(this.bodyElement);

	this.visibleIndex = 0;
	this.nameMap = new Map();

	for (var i = 0; i < this.tabElements.length; i++) {
		var tabElement = this.tabElements[i];
		var panelId = tabElement.id || ('sector-panel-' + i);
		tabElement.id = panelId;
		tabElement.setAttribute('role', 'tabpanel');
		tabElement.setAttribute('aria-labelledby', 'sector-tab-' + i);
		this.bodyElement.appendChild(tabElement);

		tabElement.classList.add(i == this.visibleIndex ? 'dyntab-visible' : 'dyntab-hidden');

		var buttonElement = document.createElement('button');
		buttonElement.type = 'button';
		buttonElement.id = 'sector-tab-' + i;
		buttonElement.innerText = tabElement.dataset.title;
		buttonElement.setAttribute('role', 'tab');
		buttonElement.setAttribute('aria-controls', panelId);
		buttonElement.setAttribute('aria-selected', i == this.visibleIndex ? 'true' : 'false');
		buttonElement.tabIndex = i == this.visibleIndex ? 0 : -1;
		buttonElement.addEventListener('click', makeButtonCallback(this, i));
		buttonElement.addEventListener('keydown', makeKeyCallback(this, i));
		this.headerElement.appendChild(buttonElement);

		buttonElement.classList.add('dyntab-button');
		buttonElement.classList.add(i == this.visibleIndex ? 'dyntab-visible' : 'dyntab-hidden');
	}

	this.buttonElements = Array.from(this.headerElement.childNodes);

	function makeButtonCallback(self, index) {
		return function() { self.setVisibleTab(index); };
	}

	function makeKeyCallback(self, index) {
		return function(event) {
			var next = index;
			if (event.key === 'ArrowRight') next = (index + 1) % self.buttonElements.length;
			else if (event.key === 'ArrowLeft') next = (index - 1 + self.buttonElements.length) % self.buttonElements.length;
			else if (event.key === 'Home') next = 0;
			else if (event.key === 'End') next = self.buttonElements.length - 1;
			else return;
			event.preventDefault();
			self.setVisibleTab(next);
			self.buttonElements[next].focus();
		};
	}
}

DynTab.prototype.setVisibleTab = function(index) {
	if (index < 0 || index >= this.tabElements.length) return;
	this.visibleIndex = index;

	for (var i = 0; i < this.tabElements.length; i++) {
		var active = i == this.visibleIndex;
		this.tabElements[i].classList.toggle('dyntab-visible', active);
		this.tabElements[i].classList.toggle('dyntab-hidden', !active);
		this.buttonElements[i].classList.toggle('dyntab-visible', active);
		this.buttonElements[i].classList.toggle('dyntab-hidden', !active);
		this.buttonElements[i].setAttribute('aria-selected', active ? 'true' : 'false');
		this.buttonElements[i].tabIndex = active ? 0 : -1;
	}
}
