import { initialSurfaceState, SURFACE_TYPES, surfaceReducer } from '../entrypoints/surface_state_machine'
import { describe, it, expect } from 'vitest'

const initialState = initialSurfaceState()

describe('Surface Reducer', () => {
    it('Started with idle', () => {
        const state = initialSurfaceState()
        expect(state.status).toBe(SURFACE_TYPES.IDLE)
    })
    it('Select the word event', () => {
        const newState = surfaceReducer({ name: 'WORD_SELECTED' }, initialState)
        expect(newState.status).toBe(SURFACE_TYPES.ICON)
    })
    it('Icon clicked event', () => {
        const newState = surfaceReducer({ name: 'ICON_CLICKED' }, initialState)
        expect(newState.status).toBe(SURFACE_TYPES.TOOLTIP)
    })
    it('Repeat event', () => {
        const newState = surfaceReducer({ name: 'REPEAT_DUE' }, initialState)
        expect(newState.status).toBe(SURFACE_TYPES.OVERLAY)
    })
    it('Click outside', () => {
        const newState = surfaceReducer({ name: 'CLICK_OUTSIDE' }, initialState)
        expect(newState.status).toBe(SURFACE_TYPES.IDLE)
    })
})