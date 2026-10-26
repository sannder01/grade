import * as THREE from 'three'
import Experience from '../Experience.js'

export default class Displacement
{
    constructor()
    {
        this.experience = new Experience()
        this.sizes = this.experience.sizes
        this.scene = this.experience.scene

        this.setCanvas()
        this.setGlowImage()
        this.setInteractivePlane()
        this.setRaycaster()
        this.setTexture()
        this.setEventListeners()
        this.setDebug()
    }

    setDebug()
    {
        this.params = {
            fadeSpeed: 0.02,
            glowSize: 0.25,
            cursorSensitivity: 0.1
        }

        const debug = this.experience.debug
        if (!debug.active) return

        const folder = debug.ui.addFolder('Displacement')

        folder
            .add(this.params, 'fadeSpeed')
            .min(0.001).max(0.2).step(0.001)
            .name('Fade Speed')

        folder
            .add(this.params, 'glowSize')
            .min(0.05).max(1.0).step(0.01)
            .name('Glow Size')

        folder
            .add(this.params, 'cursorSensitivity')
            .min(0.01).max(1.0).step(0.01)
            .name('Cursor Sensitivity')
    }

    setCanvas()
    {
        this.canvas = document.createElement('canvas')
        this.canvas.width = 128
        this.canvas.height = 128
        this.canvas.style.position = 'fixed'
        this.canvas.style.width = '128px'
        this.canvas.style.height = '128px'
        this.canvas.style.top = 0
        this.canvas.style.left = 0
        this.canvas.style.zIndex = 10
        document.body.append(this.canvas)

        this.context = this.canvas.getContext('2d')
        this.context.fillRect(0, 0, this.canvas.width, this.canvas.height)
    }

    setGlowImage()
    {
        this.glowImage = new Image()
        this.glowImage.src = './glow.png'
    }

    setInteractivePlane()
    {
        this.interactivePlane = new THREE.Mesh(
            new THREE.PlaneGeometry(10, 10),
            new THREE.MeshBasicMaterial({ color: 'red', side: THREE.DoubleSide })
        )
        this.interactivePlane.visible = false
        this.scene.add(this.interactivePlane)
    }

    setRaycaster()
    {
        this.raycaster = new THREE.Raycaster()
        this.screenCursor = new THREE.Vector2(9999, 9999)
        this.canvasCursor = new THREE.Vector2(9999, 9999)
        this.canvasCursorPrevious = new THREE.Vector2(9999, 9999)
    }

    setTexture()
    {
        this.texture = new THREE.CanvasTexture(this.canvas)
    }

    setEventListeners()
    {
        window.addEventListener('pointermove', (event) =>
        {
            this.screenCursor.x = (event.clientX / this.sizes.width) * 2 - 1
            this.screenCursor.y = (event.clientY / this.sizes.height) * 2 - 1
        })
    }

    update()
    {
        const camera = this.experience.camera.instance

        // Raycaster
        this.raycaster.setFromCamera(this.screenCursor, camera)
        const intersections = this.raycaster.intersectObject(this.interactivePlane)

        if (intersections.length)
        {
            const uv = intersections[0].uv
            this.canvasCursor.x = uv.x * this.canvas.width
            this.canvasCursor.y = uv.y * this.canvas.height
        }

        // Fade canvas
        this.context.globalCompositeOperation = 'source-over'
        this.context.globalAlpha = this.params.fadeSpeed
        this.context.fillRect(0, 0, this.canvas.width, this.canvas.height)

        // Speed alpha
        const cursorDistance = this.canvasCursorPrevious.distanceTo(this.canvasCursor)
        this.canvasCursorPrevious.copy(this.canvasCursor)
        const alpha = Math.min(cursorDistance * this.params.cursorSensitivity, 1)

        // Draw glow
        const glowSize = this.canvas.width * this.params.glowSize
        this.context.globalCompositeOperation = 'lighten'
        this.context.globalAlpha = alpha
        this.context.drawImage(
            this.glowImage,
            this.canvasCursor.x - glowSize * 0.5,
            this.canvasCursor.y - glowSize * 0.5,
            glowSize,
            glowSize
        )

        // Update texture
        this.texture.needsUpdate = true
    }
}
