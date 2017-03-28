import {
    uid, getUrlFileExtension, decomposeDataUri, getSvgSize,
    getResolutionOfUrl, BaseTextureCache, TextureCache,
} from '../utils';

import {FORMATS, TARGETS, TYPES, SCALE_MODES} from '../const';
import ImageResource from './resources/ImageResource';
import BufferResource from './resources/BufferResource';
import CanvasResource from './resources/CanvasResource';
import SVGResource from './resources/SVGResource';
import VideoResource from './resources/VideoResource';
import createResource from './resources/createResource';

import settings from '../settings';
import EventEmitter from 'eventemitter3';
import bitTwiddle from 'bit-twiddle';

export default class BaseTexture extends EventEmitter
{
    constructor(resource, scaleMode, resolution, width, height, format, type, mipmap)
    {
        super();

        this.uid = uid();

        this.touched = 0;

        /**
         * The width of texture
         *
         * @member {Number}
         */
        this.width = width || -1;
        /**
         * The height of texture
         *
         * @member {Number}
         */
        this.height = height || -1;

        /**
         * The resolution / device pixel ratio of the texture
         *
         * @member {number}
         * @default 1
         */
        this.resolution = resolution || settings.RESOLUTION;

        /**
         * Whether or not the texture is a power of two, try to use power of two textures as much
         * as you can
         *
         * @private
         * @member {boolean}
         */
        this.isPowerOfTwo = false;

        /**
         * If mipmapping was used for this texture, enable and disable with enableMipmap()
         *
         * @member {Boolean}
         */
        this.mipmap = false;//settings.MIPMAP_TEXTURES;

        /**
         * Set to true to enable pre-multiplied alpha
         *
         * @member {Boolean}
         */
        this.premultiplyAlpha = true;

        /**
         * [wrapMode description]
         * @type {[type]}
         */
        this.wrapMode = settings.WRAP_MODE;

        /**
         * The scale mode to apply when scaling this texture
         *
         * @member {number}
         * @default PIXI.settings.SCALE_MODE
         * @see PIXI.SCALE_MODES
         */
        this.scaleMode = scaleMode || settings.SCALE_MODE;

        /**
         * The pixel format of the texture. defaults to gl.RGBA
         *
         * @member {Number}
         */
        this.format = format || FORMATS.RGBA;
        this.type = type || TYPES.UNSIGNED_BYTE; //UNSIGNED_BYTE

        this.target = TARGETS.TEXTURE_2D; // gl.TEXTURE_2D

        this._glTextures = {};

        this._new = true;

        this.dirtyId = 0;

        this.valid = false;

        this.resource = null;

        if(resource)
        {
            // lets convert this to a resource..
            resource = createResource(resource);
            this.setResource(resource);
        }

        this.cacheId = null;

        this.validate();
    }

    setResource(resource)
    {
        // TODO currently a resource can only be set once..

        this.resource = resource;

        this.resource.load
        .then((resource) => {

            if(this.resource === resource)
            {
                if(resource.width !== -1 && resource.hight !== -1)
                {
                    this.width = resource.width / this.resolution;
                    this.height = resource.height / this.resolution;
                }

                this.validate();

                if(this.valid)
                {
                    this.isPowerOfTwo = bitTwiddle.isPow2(this.realWidth) && bitTwiddle.isPow2(this.realHeight);

                    // we have not swapped half way!
                    this.dirtyId++;
                    this.emit('loaded', this);
                }
            }

        })
        .catch((reason)=>{

            // failed to load - maybe resource was destroyed before it loaded.
            console.warn(reason);

        })

        this.resource.resourceUpdated.add(this); //calls resourceUpaded
    }

    resourceUpdated()
    {
        // the resource was updated..
        this.dirtyId++;
    }

    update()
    {
        this.dirtyId++;
    }

    resize(width, height)
    {
        this.width = width;
        this.height = height;

        this.dirtyId++;
    }

    validate()
    {
        let valid = true;

        if(this.width === -1 || this.height === -1)
        {
            valid = false;
        }

        this.valid = valid;
    }

    get realWidth()
    {
        return this.width * this.resolution;
    }

    get realHeight()
    {
        return this.height * this.resolution;
    }

    /**
     * Destroys this base texture
     *
     */
    destroy()
    {
        // remove from the cache..

        if (this.cacheId)
        {
            delete BaseTextureCache[this.cacheId];
            delete TextureCache[this.cacheId];

            this.cacheId = null;
        }

        // remove and destroy the resource

        if(this.resource)
        {
            this.resource.destroy();
            this.resource = null;
        }

        // finally let the webGL renderer know..
        this.dispose()
    }

    /**
     * Frees the texture from WebGL memory without destroying this texture object.
     * This means you can still use the texture later which will upload it to GPU
     * memory again.
     *
     */
    dispose()
    {
        this.emit('dispose', this);
    }

    /**
     * Helper function that creates a base texture based on the source you provide.
     * The source can be - image url, image element, canvas element.
     *
     * @static
     * @param {string|HTMLImageElement|HTMLCanvasElement} source - The source to create base texture from.
     * @param {number} [scaleMode=PIXI.settings.SCALE_MODE] - See {@link PIXI.SCALE_MODES} for possible values
     * @param {number} [sourceScale=(auto)] - Scale for the original image, used with Svg images.
     * @return {PIXI.BaseTexture} The new base texture.
     */
    static from(source, scaleMode, sourceScale)
    {
        var cacheId = null;

        if (typeof source === 'string')
        {
            cacheId = source;
        }
        else
        {
            if(!source._pixiId)
            {
                source._pixiId = `pixiid_${uid()}`;
            }

            cacheId = source._pixiId;
        }

        let baseTexture = BaseTextureCache[cacheId];

        if (!baseTexture)
        {
            baseTexture = new BaseTexture(source);
            baseTexture.cacheId
            BaseTextureCache[cacheId] = baseTexture;
        }

        // lets assume its a base texture!
        return baseTexture;
    }

    static fromFloat32Array(width, height, float32Array)
    {
        float32Array = float32Array || new Float32Array(width*height*4);

        var texture = new BaseTexture(new BufferResource(float32Array),
                                  SCALE_MODES.NEAREST,
                                  1,
                                  width,
                                  height,
                                  FORMATS.RGBA,
                                  TYPES.FLOAT);
        return texture;
    }

    static fromUint8Array(width, height, uint8Array)
    {
        uint8Array = uint8Array || new Uint8Array(width*height*4);

        var texture = new BaseTexture(new BufferResource(uint8Array),
                                  SCALE_MODES.NEAREST,
                                  1,
                                  width,
                                  height,
                                  FORMATS.RGBA,
                                  TYPES.UNSIGNED_BYTE);
        return texture;
    }

}

BaseTexture.fromImage = BaseTexture.from;
BaseTexture.fromSVG = BaseTexture.from;
BaseTexture.fromCanvas = BaseTexture.from;