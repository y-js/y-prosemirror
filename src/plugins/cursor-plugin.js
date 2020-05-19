import * as Y from 'yjs'
import { Decoration, DecorationSet } from 'prosemirror-view' // eslint-disable-line
import { Plugin, PluginKey } from 'prosemirror-state' // eslint-disable-line
import { Awareness } from 'y-protocols/awareness.js' // eslint-disable-line
import { ySyncPluginKey } from './sync-plugin.js'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, setMeta } from '../lib.js'

import * as math from 'lib0/math.js'

/**
 * The unique prosemirror plugin key for cursorPlugin.type
 *
 * @public
 */
export const yCursorPluginKey = new PluginKey('yjs-cursor')

/**
 * Default generator for a cursor element
 *
 * @param {any} user user data
 * @return HTMLElement
 */
export const defaultCursorBuilder = user => {
  const cursor = document.createElement('span')
  cursor.classList.add('ProseMirror-yjs-cursor')
  cursor.setAttribute('style', `border-color: ${user.color}`)
  const userDiv = document.createElement('div')
  userDiv.setAttribute('style', `background-color: ${user.color}`)
  userDiv.insertBefore(document.createTextNode(user.name), null)
  cursor.insertBefore(userDiv, null)
  return cursor
}

/**
 * @param {string} cursorStateName
 * @param {any} state
 * @param {Awareness} awareness
 * @param {Function} createCursor
 * @return {any} DecorationSet
 */
export const createDecorations = (cursorStateName, state, awareness, createCursor) => {
  const ystate = ySyncPluginKey.getState(state)
  const y = ystate.doc
  const decorations = []

  const yType = ystate.type

  if (ystate.snapshot != null || ystate.prevSnapshot != null || ystate.binding === null) {
    // do not render cursors while snapshot is active
    return DecorationSet.create(state.doc, [])
  }
  awareness.getStates().forEach((aw, clientId) => {
    if (clientId === y.clientID) {
      return
    }
    const cursorInfo = aw[cursorStateName]
    if (cursorInfo != null) {
      const user = aw.user || {}
      if (user.color == null) {
        user.color = '#ffa500'
      }
      if (user.name == null) {
        user.name = `User: ${clientId}`
      }
      let anchor = relativePositionToAbsolutePosition(y, yType, Y.createRelativePositionFromJSON(cursorInfo.anchor), ystate.binding.mapping)
      let head = relativePositionToAbsolutePosition(y, yType, Y.createRelativePositionFromJSON(cursorInfo.head), ystate.binding.mapping)
      if (anchor !== null && head !== null) {
        const maxsize = math.max(state.doc.content.size - 1, 0)
        anchor = math.min(anchor, maxsize)
        head = math.min(head, maxsize)
        decorations.push(Decoration.widget(head, () => createCursor(user), { key: clientId + '', side: 10 }))
        const from = math.min(anchor, head)
        const to = math.max(anchor, head)
        decorations.push(
          Decoration.inline(from, to, {
            style: `background-color: ${user.color}70`
          }, {
            inclusiveEnd: true,
            inclusiveStart: false
          })
        )
      }
    }
  })
  return DecorationSet.create(state.doc, decorations)
}

/**
 * A prosemirror plugin that listens to awareness information on Yjs.
 * This requires that a `prosemirrorPlugin` is also bound to the prosemirror.
 *
 * @public
 * @param {Awareness} awareness
 * @param {object} [opts]
 * @param {function(any):HTMLElement} [opts.cursorBuilder]
 * @param {function(any):any} [opts.getSelection]
 * @param {string} [opts.cursorStateName]
 * @return {any}
 */
export const yCursorPlugin = (awareness, { cursorBuilder = defaultCursorBuilder, getSelection = state => state.selection, cursorStateName = 'cursor' } = {}) => new Plugin({
  key: yCursorPluginKey,
  state: {
    init (_, state) {
      return createDecorations(cursorStateName, state, awareness, cursorBuilder)
    },
    apply (tr, prevState, oldState, newState) {
      const ystate = ySyncPluginKey.getState(newState)
      const yCursorState = tr.getMeta(yCursorPluginKey)
      if ((ystate && ystate.isChangeOrigin) || (yCursorState && yCursorState.awarenessUpdated)) {
        return createDecorations(cursorStateName, newState, awareness, cursorBuilder)
      }
      return prevState.map(tr.mapping, tr.doc)
    }
  },
  props: {
    decorations: state => {
      return yCursorPluginKey.getState(state)
    }
  },
  view: view => {
    const awarenessListener = () => {
      // @ts-ignore
      if (view.docView) {
        setMeta(view, yCursorPluginKey, { awarenessUpdated: true })
      }
    }
    const updateCursorInfo = () => {
      const ystate = ySyncPluginKey.getState(view.state)

      const yType = ystate.type

      // @note We make implicit checks when checking for the cursor property
      const current = awareness.getLocalState() || {}
      const currentCursorInfo = current[cursorStateName]

      if (view.hasFocus() && ystate.binding !== null) {
        const selection = getSelection(view.state)
        /**
         * @type {Y.RelativePosition}
         */
        const anchor = absolutePositionToRelativePosition(selection.anchor, yType, ystate.binding.mapping)
        /**
         * @type {Y.RelativePosition}
         */
        const head = absolutePositionToRelativePosition(selection.head, yType, ystate.binding.mapping)
        if (currentCursorInfo == null ||
          !Y.compareRelativePositions(Y.createRelativePositionFromJSON(currentCursorInfo.head), head) ||
          !Y.compareRelativePositions(Y.createRelativePositionFromJSON(currentCursorInfo.anchor), anchor)
        ) {
          awareness.setLocalStateField(cursorStateName, {
            anchor, head
          })
        }
      } else if (currentCursorInfo != null) {
        awareness.setLocalStateField(cursorStateName, null)
      }
    }
    awareness.on('change', awarenessListener)
    view.dom.addEventListener('focusin', updateCursorInfo)
    view.dom.addEventListener('focusout', updateCursorInfo)
    return {
      update: updateCursorInfo,
      destroy: () => {
        awareness.off('change', awarenessListener)
        awareness.setLocalStateField(cursorStateName, null)
      }
    }
  }
})
