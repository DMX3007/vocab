import { initialSurfaceState, surfaceReducer } from '../entrypoints/surface_state_machine'
import { describe, it, expect } from 'vitest'

const initialState = initialSurfaceState()

describe('Surface Reducer', () => {
    it('Started with idle', () => {
        const state = initialSurfaceState()
        expect(state.status).toBe('idle')
    })
    it('Select the word event', () => {
        const newState = surfaceReducer(initialState, { name: 'WORD_SELECTED', term: 'test', contextSentence: 'this is a test', x: 100, y: 200 })
        expect(newState).toEqual({
            status: 'icon',
            term: 'test',
            contextSentence: 'this is a test',
            x: 100,
            y: 200
        })
    })
    it('Icon clicked event', () => {
        const newState = surfaceReducer(initialState, { name: 'ICON_CLICKED' })
        expect(newState.status).toBe('tooltip')
    })
    it('Repeat event', () => {
        const newState = surfaceReducer(initialState, { name: 'REPEAT_DUE' })
        expect(newState.status).toBe('overlay')
    })
    it('Click outside', () => {
        const newState = surfaceReducer(initialState, { name: 'CLICK_OUTSIDE' })
        expect(newState.status).toBe('idle')
    })
    it('Selection collapsed', () => {
        const newState = surfaceReducer(initialState, { name: 'SELECTION_COLLAPSED' })
        expect(newState.status).toBe('idle')
    })
    it('Word saved', () => {
        const newState = surfaceReducer(initialState, { name: 'WORD_SAVED' })
        expect(newState.status).toBe('idle')
    })
})