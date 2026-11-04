// Small fills for webOS 4 (Chromium 53). Kept in old syntax on purpose.
(function () {
  function appendNodes(parent, items) {
    var i, node;
    for (i = 0; i < items.length; i++) {
      node = items[i];
      if (node == null) continue;
      if (typeof node === 'string' || typeof node === 'number') {
        parent.appendChild(parent.ownerDocument.createTextNode(String(node)));
      } else {
        parent.appendChild(node);
      }
    }
  }

  if (typeof Element !== 'undefined' && !Element.prototype.append) {
    Element.prototype.append = function () {
      appendNodes(this, arguments);
    };
  }
  if (typeof DocumentFragment !== 'undefined' && !DocumentFragment.prototype.append) {
    DocumentFragment.prototype.append = function () {
      appendNodes(this, arguments);
    };
  }
  if (typeof Element !== 'undefined' && !Element.prototype.replaceChildren) {
    Element.prototype.replaceChildren = function () {
      while (this.firstChild) this.removeChild(this.firstChild);
      appendNodes(this, arguments);
    };
  }
  if (typeof NodeList !== 'undefined' && NodeList.prototype && !NodeList.prototype.forEach) {
    NodeList.prototype.forEach = Array.prototype.forEach;
  }
})();
