'use strict'

const { Menu, clipboard } = require('electron')

/**
 * Builds the page context menu for a tab.
 * @param {object} ctx
 * @param {Electron.WebContents} ctx.wc
 * @param {Electron.ContextMenuParams} ctx.params
 * @param {(url: string, opts?: object) => void} ctx.openTab
 * @param {(url: string) => void} ctx.openPrivate
 * @param {(query: string) => string} ctx.searchUrl
 * @param {Electron.MenuItem[]} ctx.extensionItems
 */
function buildContextMenu({ wc, params, openTab, openPrivate, searchUrl, extensionItems, translateText, translatePage, togglePip, generatePassword }) {
  const items = []
  const pushAll = (...list) => items.push(...list.filter(Boolean))
  const sep = () => items.length && items[items.length - 1].type !== 'separator' && items.push({ type: 'separator' })

  if (params.linkURL) {
    items.push(
      { label: 'Link in neuem Tab öffnen', click: () => openTab(params.linkURL, { active: false }) },
      { label: 'Link in privatem Fenster öffnen', click: () => openPrivate(params.linkURL) },
      { label: 'Linkadresse kopieren', click: () => clipboard.writeText(params.linkURL) },
    )
    sep()
  }
  if (params.mediaType === 'image' && params.srcURL) {
    items.push(
      { label: 'Bild in neuem Tab öffnen', click: () => openTab(params.srcURL, { active: false }) },
      { label: 'Bild speichern unter …', click: () => wc.downloadURL(params.srcURL) },
      { label: 'Bild kopieren', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Bildadresse kopieren', click: () => clipboard.writeText(params.srcURL) },
    )
    sep()
  }
  if (params.mediaType === 'video' && togglePip) {
    items.push({ label: 'Bild-in-Bild', click: () => togglePip() })
    sep()
  }
  const isWeb = /^https?:/.test(wc.getURL())
  if (params.isEditable && params.formControlType === 'input-password' && isWeb && generatePassword && params.frame === wc.mainFrame) {
    items.push({ label: 'Sicheres Passwort erzeugen', click: () => generatePassword() })
    sep()
  }
  if (params.isEditable) {
    if (params.misspelledWord) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) })
      items.push({ label: 'Zum Wörterbuch hinzufügen', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) })
      sep()
    }
    items.push(
      { label: 'Rückgängig', role: 'undo', enabled: params.editFlags.canUndo },
      { label: 'Wiederholen', role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { label: 'Ausschneiden', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Kopieren', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Einfügen', role: 'paste', enabled: params.editFlags.canPaste },
      { label: 'Alles auswählen', role: 'selectAll' },
    )
    sep()
  } else if (params.selectionText) {
    const text = params.selectionText.trim()
    const extra = [
      { label: 'Kopieren', role: 'copy' },
      { label: `Nach „${text.length > 30 ? `${text.slice(0, 30)}…` : text}“ suchen`, click: () => openTab(searchUrl(text)) },
      translateText && { label: 'Auswahl übersetzen', click: () => translateText(text) },
    ].filter(Boolean)
    items.push(...extra)
    sep()
  }
  if (!params.linkURL && !params.isEditable && !params.selectionText && params.mediaType === 'none') {
    pushAll(
      { label: 'Zurück', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Vorwärts', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Neu laden', click: () => wc.reload() },
      { type: 'separator' },
      isWeb && translatePage && { label: 'Seite übersetzen', click: () => translatePage() },
      { label: 'Speichern unter …', click: () => wc.downloadURL(wc.getURL()) },
      { label: 'Drucken …', click: () => wc.print() },
      { label: 'Seitenquelltext anzeigen', click: () => openTab(`view-source:${wc.getURL()}`) },
    )
    sep()
  }
  if (extensionItems && extensionItems.length) {
    items.push(...extensionItems)
    sep()
  }
  items.push({ label: 'Untersuchen', click: () => { wc.inspectElement(params.x, params.y); if (wc.isDevToolsOpened()) wc.devToolsWebContents?.focus() } })

  return Menu.buildFromTemplate(items)
}

module.exports = { buildContextMenu }
