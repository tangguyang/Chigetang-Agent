"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/mediainfo.js/dist/cjs/error.cjs
var require_error = __commonJS({
  "node_modules/mediainfo.js/dist/cjs/error.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.unknownToError = unknownToError;
    function isError(error) {
      return error !== null && typeof error === "object" && Object.prototype.hasOwnProperty.call(error, "message");
    }
    function unknownToError(error) {
      if (isError(error)) {
        return error;
      }
      return new Error(typeof error === "string" ? error : "Unknown error");
    }
  }
});

// node_modules/mediainfo.js/dist/cjs/MediaInfoResult.cjs
var require_MediaInfoResult = __commonJS({
  "node_modules/mediainfo.js/dist/cjs/MediaInfoResult.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.INT_FIELDS = exports2.FLOAT_FIELDS = void 0;
    var INT_FIELDS = exports2.INT_FIELDS = ["Active_Height", "Active_Width", "AudioCount", "Audio_Channels_Total", "BitDepth_Detected", "BitDepth", "BitDepth_Stored", "Channels", "Channels_Original", "Chapters_Pos_Begin", "Chapters_Pos_End", "Comic_Position_Total", "Count", "DataSize", "ElementCount", "EPG_Positions_Begin", "EPG_Positions_End", "FirstPacketOrder", "FooterSize", "Format_Settings_GMC", "Format_Settings_RefFrames", "Format_Settings_SliceCount", "FrameCount", "FrameRate_Den", "FrameRate_Num", "GeneralCount", "HeaderSize", "Height_CleanAperture", "Height", "Height_Offset", "Height_Original", "ImageCount", "Lines_MaxCharacterCount", "Lines_MaxCountPerEvent", "Matrix_Channels", "MenuCount", "OtherCount", "Part_Position", "Part_Position_Total", "Played_Count", "Reel_Position", "Reel_Position_Total", "Resolution", "Sampled_Height", "Sampled_Width", "SamplingCount", "Season_Position", "Season_Position_Total", "Source_FrameCount", "Source_SamplingCount", "Source_StreamSize_Encoded", "Source_StreamSize", "Status", "Stored_Height", "Stored_Width", "StreamCount", "StreamKindID", "StreamKindPos", "StreamSize_Demuxed", "StreamSize_Encoded", "StreamSize", "TextCount", "Track_Position", "Track_Position_Total", "Video0_Delay", "VideoCount", "Width_CleanAperture", "Width", "Width_Offset", "Width_Original"];
    var FLOAT_FIELDS = exports2.FLOAT_FIELDS = ["Active_DisplayAspectRatio", "BitRate_Encoded", "BitRate_Maximum", "BitRate_Minimum", "BitRate", "BitRate_Nominal", "Bits-Pixel_Frame", "BitsPixel_Frame", "Compression_Ratio", "Delay", "Delay_Original", "DisplayAspectRatio_CleanAperture", "DisplayAspectRatio", "DisplayAspectRatio_Original", "Duration_End_Command", "Duration_End", "Duration_FirstFrame", "Duration_LastFrame", "Duration", "Duration_Start2End", "Duration_Start_Command", "Duration_Start", "Events_MinDuration", "FrameRate_Maximum", "FrameRate_Minimum", "FrameRate", "FrameRate_Nominal", "FrameRate_Original_Den", "FrameRate_Original", "FrameRate_Original_Num", "FrameRate_Real", "Interleave_Duration", "Interleave_Preload", "Interleave_VideoFrames", "MasteringDisplay_Luminance_Max", "MasteringDisplay_Luminance_Min", "MaxCLL", "MaxCLL_Original", "MaxFALL", "MaxFALL_Original", "OverallBitRate_Maximum", "OverallBitRate_Minimum", "OverallBitRate", "OverallBitRate_Nominal", "PixelAspectRatio_CleanAperture", "PixelAspectRatio", "PixelAspectRatio_Original", "SamplesPerFrame", "SamplingRate", "Source_Duration_FirstFrame", "Source_Duration_LastFrame", "Source_Duration", "TimeStamp_FirstFrame", "Video_Delay"];
  }
});

// node_modules/mediainfo.js/dist/cjs/MediaInfo.cjs
var require_MediaInfo = __commonJS({
  "node_modules/mediainfo.js/dist/cjs/MediaInfo.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.default = exports2.FORMAT_CHOICES = exports2.DEFAULT_OPTIONS = void 0;
    var _error = require_error();
    var _MediaInfoResult = require_MediaInfoResult();
    var FORMAT_CHOICES = exports2.FORMAT_CHOICES = ["JSON", "XML", "HTML", "text"];
    var DEFAULT_OPTIONS = exports2.DEFAULT_OPTIONS = {
      coverData: false,
      chunkSize: 256 * 1024,
      format: "object",
      full: false
    };
    var MediaInfo = class {
      isAnalyzing = false;
      /** @group General Use */
      /**
       * The constructor should not be called directly, instead use {@link mediaInfoFactory}.
       *
       * @hidden
       * @param mediainfoModule WASM module
       * @param options User options
       */
      constructor(mediainfoModule, options) {
        this.mediainfoModule = mediainfoModule;
        this.options = options;
        this.ptr = this.instantiateModuleInstance();
      }
      /**
       * Convenience method for analyzing a buffer chunk by chunk.
       *
       * @param size Return total buffer size in bytes.
       * @param readChunk Read chunk of data and return an {@link Uint8Array}.
       * @group General Use
       */
      /**
       * Convenience method for analyzing a buffer chunk by chunk.
       *
       * @param size Return total buffer size in bytes.
       * @param readChunk Read chunk of data and return an {@link Uint8Array}.
       * @param callback Function that is called once the processing is done
       * @group General Use
       */
      analyzeData(size, readChunk, callback) {
        if (callback === void 0) {
          return new Promise((resolve2, reject) => {
            const resultCb = (result, error) => {
              this.isAnalyzing = false;
              if (error || !result) {
                reject((0, _error.unknownToError)(error));
              } else {
                resolve2(result);
              }
            };
            this.analyzeData(size, readChunk, resultCb);
          });
        }
        if (this.isAnalyzing) {
          callback(null, new Error("cannot start a new analysis while another is in progress"));
          return;
        }
        this.reset();
        this.isAnalyzing = true;
        const finalize = () => {
          try {
            this.openBufferFinalize();
            const result = this.inform();
            if (this.options.format === "object") {
              callback(this.parseResultJson(result));
            } else {
              callback(result);
            }
          } finally {
            this.isAnalyzing = false;
          }
        };
        let offset = 0;
        const runReadDataLoop = (fileSize) => {
          const readNextChunk = (data) => {
            if (continueBuffer(data)) {
              getChunk();
            } else {
              finalize();
            }
          };
          const getChunk = () => {
            let dataValue;
            try {
              const safeSize = Math.min(this.options.chunkSize, fileSize - offset);
              dataValue = readChunk(safeSize, offset);
            } catch (error) {
              this.isAnalyzing = false;
              callback(null, (0, _error.unknownToError)(error));
              return;
            }
            if (dataValue instanceof Promise) {
              dataValue.then(readNextChunk).catch((error) => {
                this.isAnalyzing = false;
                callback(null, (0, _error.unknownToError)(error));
              });
            } else {
              readNextChunk(dataValue);
            }
          };
          const continueBuffer = (data) => {
            if (data.length === 0 || this.openBufferContinue(data, data.length)) {
              return false;
            }
            const seekTo = this.openBufferContinueGotoGet();
            if (seekTo === -1) {
              offset += data.length;
            } else {
              offset = seekTo;
              this.openBufferInit(fileSize, seekTo);
            }
            return true;
          };
          this.openBufferInit(fileSize, offset);
          getChunk();
        };
        const fileSizeValue = typeof size === "function" ? size() : size;
        if (fileSizeValue instanceof Promise) {
          fileSizeValue.then(runReadDataLoop).catch((error) => {
            callback(null, (0, _error.unknownToError)(error));
          });
        } else {
          runReadDataLoop(fileSizeValue);
        }
      }
      /**
       * Close the MediaInfoLib WASM instance.
       *
       * @group General Use
       */
      close() {
        if (this.ptr) {
          this.mediainfoModule._mi_close(this.ptr);
        }
      }
      /**
       * Reset the MediaInfoLib WASM instance to its initial state.
       *
       * This method ensures that the instance is ready for a new parse.
       * @group General Use
       */
      reset() {
        if (this.ptr) {
          this.mediainfoModule._mi_delete(this.ptr);
        }
        this.ptr = this.instantiateModuleInstance();
      }
      /**
       * Receive result data from the WASM instance.
       *
       * (This is a low-level MediaInfoLib function.)
       *
       * @returns Result data (format can be configured in options)
       * @group Low-level
       */
      inform() {
        const resPtr = this.mediainfoModule._mi_inform(this.ptr);
        return this.mediainfoModule.UTF8ToString(resPtr);
      }
      /**
       * Send more data to the WASM instance.
       *
       * (This is a low-level MediaInfoLib function.)
       *
       * @param data Data buffer
       * @param size Buffer size
       * @returns Processing state: `0` (no bits set) = not finished, Bit `0` set = enough data read for providing information
       * @group Low-level
       */
      openBufferContinue(data, size) {
        const dataPtr = this.mediainfoModule._malloc(size);
        this.mediainfoModule.HEAPU8.set(data, dataPtr);
        const result = this.mediainfoModule._mi_open_buffer_continue(this.ptr, dataPtr, size);
        this.mediainfoModule._free(dataPtr);
        return !!(result & 8);
      }
      /**
       * Retrieve seek position from WASM instance.
       * The MediaInfoLib function `Open_Buffer_GoTo` returns an integer with 64 bit precision.
       * It would be cut at 32 bit due to the JavaScript bindings. Here we transport the low and high
       * parts separately and put them together.
       *
       * (This is a low-level MediaInfoLib function.)
       *
       * @returns Seek position (where MediaInfoLib wants go in the data buffer)
       * @group Low-level
       */
      openBufferContinueGotoGet() {
        const seekTo = this.mediainfoModule._mi_open_buffer_continue_goto_get(this.ptr);
        return Number(seekTo);
      }
      /**
       * Inform MediaInfoLib that no more data is being read.
       *
       * (This is a low-level MediaInfoLib function.)
       *
       * @group Low-level
       */
      openBufferFinalize() {
        this.mediainfoModule._mi_open_buffer_finalize(this.ptr);
      }
      /**
       * Prepare MediaInfoLib to process a data buffer.
       *
       * (This is a low-level MediaInfoLib function.)
       *
       * @param size Expected buffer size
       * @param offset Buffer offset
       * @group Low-level
       */
      openBufferInit(size, offset) {
        this.mediainfoModule._mi_open_buffer_init(this.ptr, BigInt(size), BigInt(offset));
      }
      /**
       * Parse result JSON. Convert integer/float fields.
       *
       * @param result Serialized JSON from MediaInfo
       * @returns Parsed JSON object
       */
      parseResultJson(resultString) {
        const intFields = _MediaInfoResult.INT_FIELDS;
        const floatFields = _MediaInfoResult.FLOAT_FIELDS;
        const result = JSON.parse(resultString);
        if (result.media) {
          const newMedia = {
            ...result.media,
            track: []
          };
          if (Array.isArray(result.media.track)) {
            for (const track of result.media.track) {
              let newTrack = {
                "@type": track["@type"]
              };
              for (const [key, val] of Object.entries(track)) {
                if (key === "@type") {
                  continue;
                }
                if (typeof val === "string" && intFields.includes(key)) {
                  newTrack = {
                    ...newTrack,
                    [key]: Number.parseInt(val, 10)
                  };
                } else if (typeof val === "string" && floatFields.includes(key)) {
                  newTrack = {
                    ...newTrack,
                    [key]: Number.parseFloat(val)
                  };
                } else {
                  newTrack = {
                    ...newTrack,
                    [key]: val
                  };
                }
              }
              newMedia.track.push(newTrack);
            }
          }
          return {
            ...result,
            media: newMedia
          };
        }
        return result;
      }
      /**
       * Instantiate a new WASM module instance.
       *
       * @returns MediaInfo module instance
       */
      instantiateModuleInstance() {
        const format = this.options.format === "object" ? "JSON" : this.options.format;
        const bytesNeeded = this.mediainfoModule.lengthBytesUTF8(format) + 1;
        const formatPtr = this.mediainfoModule._malloc(bytesNeeded);
        try {
          this.mediainfoModule.stringToUTF8(format, formatPtr, bytesNeeded);
          return this.mediainfoModule._mi_new(formatPtr, this.options.coverData ? 1 : 0, this.options.full ? 1 : 0);
        } finally {
          this.mediainfoModule._free(formatPtr);
        }
      }
    };
    var _default = exports2.default = MediaInfo;
  }
});

// node_modules/mediainfo.js/dist/cjs/MediaInfoModule.cjs
var require_MediaInfoModule = __commonJS({
  "node_modules/mediainfo.js/dist/cjs/MediaInfoModule.cjs"(exports2, module2) {
    async function Module(moduleArg = {}) {
      var moduleRtn;
      var Module2 = moduleArg;
      var ENVIRONMENT_IS_NODE = true;
      var arguments_ = [];
      var thisProgram = "./this.program";
      var quit_ = (status, toThrow) => {
        throw toThrow;
      };
      var _scriptName;
      if (typeof __filename != "undefined") {
        _scriptName = __filename;
      } else {
      }
      var scriptDirectory = "";
      function locateFile(path) {
        if (Module2["locateFile"]) {
          return Module2["locateFile"](path, scriptDirectory);
        }
        return scriptDirectory + path;
      }
      var readAsync, readBinary;
      if (ENVIRONMENT_IS_NODE) {
        var fs = require("fs");
        scriptDirectory = __dirname + "/";
        readBinary = (filename) => {
          filename = isFileURI(filename) ? new URL(filename) : filename;
          var ret = fs.readFileSync(filename);
          return ret;
        };
        readAsync = async (filename, binary = true) => {
          filename = isFileURI(filename) ? new URL(filename) : filename;
          var ret = fs.readFileSync(filename, binary ? void 0 : "utf8");
          return ret;
        };
        if (process.argv.length > 1) {
          thisProgram = process.argv[1].replace(/\\/g, "/");
        }
        arguments_ = process.argv.slice(2);
        quit_ = (status, toThrow) => {
          process.exitCode = status;
          throw toThrow;
        };
      } else {
      }
      var out = console.log.bind(console);
      var err = console.error.bind(console);
      var wasmBinary;
      var ABORT = false;
      var EXITSTATUS;
      var isFileURI = (filename) => filename.startsWith("file://");
      var readyPromiseResolve, readyPromiseReject;
      var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
      var HEAP64, HEAPU64;
      var runtimeInitialized = false;
      function updateMemoryViews() {
        var b = wasmMemory.buffer;
        HEAP8 = new Int8Array(b);
        HEAP16 = new Int16Array(b);
        Module2["HEAPU8"] = HEAPU8 = new Uint8Array(b);
        HEAPU16 = new Uint16Array(b);
        HEAP32 = new Int32Array(b);
        HEAPU32 = new Uint32Array(b);
        HEAPF32 = new Float32Array(b);
        HEAPF64 = new Float64Array(b);
        HEAP64 = new BigInt64Array(b);
        HEAPU64 = new BigUint64Array(b);
      }
      function preRun() {
      }
      function initRuntime() {
        runtimeInitialized = true;
        wasmExports["n"]();
      }
      function postRun() {
      }
      function abort(what) {
        Module2["onAbort"]?.(what);
        what = "Aborted(" + what + ")";
        err(what);
        ABORT = true;
        what += ". Build with -sASSERTIONS for more info.";
        var e = new WebAssembly.RuntimeError(what);
        readyPromiseReject?.(e);
        throw e;
      }
      var wasmBinaryFile;
      function findWasmBinary() {
        return locateFile("MediaInfoModule.wasm");
      }
      function getBinarySync(file) {
        if (readBinary) {
          return readBinary(file);
        }
        throw "both async and sync fetching of the wasm failed";
      }
      async function getWasmBinary(binaryFile) {
        if (!wasmBinary) {
          try {
            var response = await readAsync(binaryFile);
            return new Uint8Array(response);
          } catch {
          }
        }
        return getBinarySync(binaryFile);
      }
      async function instantiateArrayBuffer(binaryFile, imports) {
        try {
          var binary = await getWasmBinary(binaryFile);
          var instance = await WebAssembly.instantiate(binary, imports);
          return instance;
        } catch (reason) {
          err(`failed to asynchronously prepare wasm: ${reason}`);
          abort(reason);
        }
      }
      async function instantiateAsync(binary, binaryFile, imports) {
        if (!binary && !ENVIRONMENT_IS_NODE) {
          try {
            var response = fetch(binaryFile, { credentials: "same-origin" });
            var instantiationResult = await WebAssembly.instantiateStreaming(response, imports);
            return instantiationResult;
          } catch (reason) {
            err(`wasm streaming compile failed: ${reason}`);
            err("falling back to ArrayBuffer instantiation");
          }
        }
        return instantiateArrayBuffer(binaryFile, imports);
      }
      function getWasmImports() {
        var imports = { a: wasmImports };
        return imports;
      }
      async function createWasm() {
        function receiveInstance(instance, module3) {
          wasmExports = instance.exports;
          assignWasmExports(wasmExports);
          updateMemoryViews();
          return wasmExports;
        }
        function receiveInstantiationResult(result2) {
          return receiveInstance(result2["instance"]);
        }
        var info = getWasmImports();
        wasmBinaryFile ??= findWasmBinary();
        var result = await instantiateAsync(wasmBinary, wasmBinaryFile, info);
        var exports3 = receiveInstantiationResult(result);
        return exports3;
      }
      class ExitStatus {
        name = "ExitStatus";
        constructor(status) {
          this.message = `Program terminated with exit(${status})`;
          this.status = status;
        }
      }
      var __abort_js = () => abort("");
      var runtimeKeepaliveCounter = 0;
      var __emscripten_runtime_keepalive_clear = () => {
        runtimeKeepaliveCounter = 0;
      };
      var INT53_MAX = 9007199254740992;
      var INT53_MIN = -9007199254740992;
      var bigintToI53Checked = (num) => num < INT53_MIN || num > INT53_MAX ? NaN : Number(num);
      function __gmtime_js(time, tmPtr) {
        time = bigintToI53Checked(time);
        var date = new Date(time * 1e3);
        HEAP32[tmPtr >> 2] = date.getUTCSeconds();
        HEAP32[tmPtr + 4 >> 2] = date.getUTCMinutes();
        HEAP32[tmPtr + 8 >> 2] = date.getUTCHours();
        HEAP32[tmPtr + 12 >> 2] = date.getUTCDate();
        HEAP32[tmPtr + 16 >> 2] = date.getUTCMonth();
        HEAP32[tmPtr + 20 >> 2] = date.getUTCFullYear() - 1900;
        HEAP32[tmPtr + 24 >> 2] = date.getUTCDay();
        var start = Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
        var yday = (date.getTime() - start) / (1e3 * 60 * 60 * 24) | 0;
        HEAP32[tmPtr + 28 >> 2] = yday;
      }
      var timers = {};
      var handleException = (e) => {
        if (e instanceof ExitStatus || e == "unwind") {
          return EXITSTATUS;
        }
        quit_(1, e);
      };
      var keepRuntimeAlive = () => true;
      var _proc_exit = (code) => {
        EXITSTATUS = code;
        if (!keepRuntimeAlive()) {
          ABORT = true;
        }
        quit_(code, new ExitStatus(code));
      };
      var exitJS = (status, implicit) => {
        EXITSTATUS = status;
        _proc_exit(status);
      };
      var _exit = exitJS;
      var maybeExit = () => {
        if (!keepRuntimeAlive()) {
          try {
            _exit(EXITSTATUS);
          } catch (e) {
            handleException(e);
          }
        }
      };
      var callUserCallback = (func) => {
        if (ABORT) {
          return;
        }
        try {
          func();
          maybeExit();
        } catch (e) {
          handleException(e);
        }
      };
      var _emscripten_get_now = () => performance.now();
      var __setitimer_js = (which, timeout_ms) => {
        if (timers[which]) {
          clearTimeout(timers[which].id);
          delete timers[which];
        }
        if (!timeout_ms) return 0;
        var id = setTimeout(() => {
          delete timers[which];
          callUserCallback(() => __emscripten_timeout(which, _emscripten_get_now()));
        }, timeout_ms);
        timers[which] = { id, timeout_ms };
        return 0;
      };
      var stringToUTF8Array = (str, heap, outIdx, maxBytesToWrite) => {
        if (!(maxBytesToWrite > 0)) return 0;
        var startIdx = outIdx;
        var endIdx = outIdx + maxBytesToWrite - 1;
        for (var i = 0; i < str.length; ++i) {
          var u = str.codePointAt(i);
          if (u <= 127) {
            if (outIdx >= endIdx) break;
            heap[outIdx++] = u;
          } else if (u <= 2047) {
            if (outIdx + 1 >= endIdx) break;
            heap[outIdx++] = 192 | u >> 6;
            heap[outIdx++] = 128 | u & 63;
          } else if (u <= 65535) {
            if (outIdx + 2 >= endIdx) break;
            heap[outIdx++] = 224 | u >> 12;
            heap[outIdx++] = 128 | u >> 6 & 63;
            heap[outIdx++] = 128 | u & 63;
          } else {
            if (outIdx + 3 >= endIdx) break;
            heap[outIdx++] = 240 | u >> 18;
            heap[outIdx++] = 128 | u >> 12 & 63;
            heap[outIdx++] = 128 | u >> 6 & 63;
            heap[outIdx++] = 128 | u & 63;
            i++;
          }
        }
        heap[outIdx] = 0;
        return outIdx - startIdx;
      };
      var stringToUTF8 = (str, outPtr, maxBytesToWrite) => stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
      var __tzset_js = (timezone, daylight, std_name, dst_name) => {
        var currentYear = (/* @__PURE__ */ new Date()).getFullYear();
        var winter = new Date(currentYear, 0, 1);
        var summer = new Date(currentYear, 6, 1);
        var winterOffset = winter.getTimezoneOffset();
        var summerOffset = summer.getTimezoneOffset();
        var stdTimezoneOffset = Math.max(winterOffset, summerOffset);
        HEAPU32[timezone >> 2] = stdTimezoneOffset * 60;
        HEAP32[daylight >> 2] = Number(winterOffset != summerOffset);
        var extractZone = (timezoneOffset) => {
          var sign = timezoneOffset >= 0 ? "-" : "+";
          var absOffset = Math.abs(timezoneOffset);
          var hours = String(Math.floor(absOffset / 60)).padStart(2, "0");
          var minutes = String(absOffset % 60).padStart(2, "0");
          return `UTC${sign}${hours}${minutes}`;
        };
        var winterName = extractZone(winterOffset);
        var summerName = extractZone(summerOffset);
        if (summerOffset < winterOffset) {
          stringToUTF8(winterName, std_name, 17);
          stringToUTF8(summerName, dst_name, 17);
        } else {
          stringToUTF8(winterName, dst_name, 17);
          stringToUTF8(summerName, std_name, 17);
        }
      };
      var _emscripten_date_now = () => Date.now();
      var getHeapMax = () => 2147483648;
      var alignMemory = (size, alignment) => Math.ceil(size / alignment) * alignment;
      var growMemory = (size) => {
        var oldHeapSize = wasmMemory.buffer.byteLength;
        var pages = (size - oldHeapSize + 65535) / 65536 | 0;
        try {
          wasmMemory.grow(pages);
          updateMemoryViews();
          return 1;
        } catch (e) {
        }
      };
      var _emscripten_resize_heap = (requestedSize) => {
        var oldSize = HEAPU8.length;
        requestedSize >>>= 0;
        var maxHeapSize = getHeapMax();
        if (requestedSize > maxHeapSize) {
          return false;
        }
        for (var cutDown = 1; cutDown <= 4; cutDown *= 2) {
          var overGrownHeapSize = oldSize * (1 + 0.2 / cutDown);
          overGrownHeapSize = Math.min(overGrownHeapSize, requestedSize + 100663296);
          var newSize = Math.min(
            maxHeapSize,
            alignMemory(Math.max(requestedSize, overGrownHeapSize), 65536)
          );
          var replacement = growMemory(newSize);
          if (replacement) {
            return true;
          }
        }
        return false;
      };
      var ENV = {};
      var getExecutableName = () => thisProgram || "./this.program";
      var getEnvStrings = () => {
        if (!getEnvStrings.strings) {
          var lang = (globalThis.navigator?.language ?? "C").replace("-", "_") + ".UTF-8";
          var env = {
            USER: "web_user",
            LOGNAME: "web_user",
            PATH: "/",
            PWD: "/",
            HOME: "/home/web_user",
            LANG: lang,
            _: getExecutableName()
          };
          for (var x in ENV) {
            if (ENV[x] === void 0) delete env[x];
            else env[x] = ENV[x];
          }
          var strings = [];
          for (var x in env) {
            strings.push(`${x}=${env[x]}`);
          }
          getEnvStrings.strings = strings;
        }
        return getEnvStrings.strings;
      };
      var _environ_get = (__environ, environ_buf) => {
        var bufSize = 0;
        var envp = 0;
        for (var string of getEnvStrings()) {
          var ptr = environ_buf + bufSize;
          HEAPU32[__environ + envp >> 2] = ptr;
          bufSize += stringToUTF8(string, ptr, Infinity) + 1;
          envp += 4;
        }
        return 0;
      };
      var lengthBytesUTF8 = (str) => {
        var len = 0;
        for (var i = 0; i < str.length; ++i) {
          var c = str.charCodeAt(i);
          if (c <= 127) {
            len++;
          } else if (c <= 2047) {
            len += 2;
          } else if (c >= 55296 && c <= 57343) {
            len += 4;
            ++i;
          } else {
            len += 3;
          }
        }
        return len;
      };
      var _environ_sizes_get = (penviron_count, penviron_buf_size) => {
        var strings = getEnvStrings();
        HEAPU32[penviron_count >> 2] = strings.length;
        var bufSize = 0;
        for (var string of strings) {
          bufSize += lengthBytesUTF8(string) + 1;
        }
        HEAPU32[penviron_buf_size >> 2] = bufSize;
        return 0;
      };
      var _fd_close = (fd) => 52;
      var printCharBuffers = [null, [], []];
      var UTF8Decoder = new TextDecoder();
      var findStringEnd = (heapOrArray, idx, maxBytesToRead, ignoreNul) => {
        var maxIdx = idx + maxBytesToRead;
        if (ignoreNul) return maxIdx;
        while (heapOrArray[idx] && !(idx >= maxIdx)) ++idx;
        return idx;
      };
      var UTF8ArrayToString = (heapOrArray, idx = 0, maxBytesToRead, ignoreNul) => {
        var endPtr = findStringEnd(heapOrArray, idx, maxBytesToRead, ignoreNul);
        return UTF8Decoder.decode(
          heapOrArray.buffer ? heapOrArray.subarray(idx, endPtr) : new Uint8Array(heapOrArray.slice(idx, endPtr))
        );
      };
      var printChar = (stream, curr) => {
        var buffer = printCharBuffers[stream];
        if (curr === 0 || curr === 10) {
          ;
          (stream === 1 ? out : err)(UTF8ArrayToString(buffer));
          buffer.length = 0;
        } else {
          buffer.push(curr);
        }
      };
      var UTF8ToString = (ptr, maxBytesToRead, ignoreNul) => {
        if (!ptr) return "";
        var end = findStringEnd(HEAPU8, ptr, maxBytesToRead, ignoreNul);
        return UTF8Decoder.decode(HEAPU8.subarray(ptr, end));
      };
      var _fd_write = (fd, iov, iovcnt, pnum) => {
        var num = 0;
        for (var i = 0; i < iovcnt; i++) {
          var ptr = HEAPU32[iov >> 2];
          var len = HEAPU32[iov + 4 >> 2];
          iov += 8;
          for (var j = 0; j < len; j++) {
            printChar(fd, HEAPU8[ptr + j]);
          }
          num += len;
        }
        HEAPU32[pnum >> 2] = num;
        return 0;
      };
      {
        if (Module2["print"]) out = Module2["print"];
        if (Module2["printErr"]) err = Module2["printErr"];
      }
      Module2["UTF8ToString"] = UTF8ToString;
      Module2["stringToUTF8"] = stringToUTF8;
      Module2["lengthBytesUTF8"] = lengthBytesUTF8;
      var _mi_new, _mi_delete, _mi_open_buffer_init, _mi_open_buffer_continue, _mi_open_buffer_continue_goto_get, _mi_open_buffer_finalize, _mi_inform, _mi_close, _malloc, _free, __emscripten_timeout, memory, __indirect_function_table, wasmMemory;
      function assignWasmExports(wasmExports2) {
        _mi_new = Module2["_mi_new"] = wasmExports2["o"];
        _mi_delete = Module2["_mi_delete"] = wasmExports2["p"];
        _mi_open_buffer_init = Module2["_mi_open_buffer_init"] = wasmExports2["q"];
        _mi_open_buffer_continue = Module2["_mi_open_buffer_continue"] = wasmExports2["r"];
        _mi_open_buffer_continue_goto_get = Module2["_mi_open_buffer_continue_goto_get"] = wasmExports2["s"];
        _mi_open_buffer_finalize = Module2["_mi_open_buffer_finalize"] = wasmExports2["t"];
        _mi_inform = Module2["_mi_inform"] = wasmExports2["u"];
        _mi_close = Module2["_mi_close"] = wasmExports2["v"];
        _malloc = Module2["_malloc"] = wasmExports2["w"];
        _free = Module2["_free"] = wasmExports2["x"];
        __emscripten_timeout = wasmExports2["y"];
        memory = wasmMemory = wasmExports2["m"];
        __indirect_function_table = wasmExports2["__indirect_function_table"];
      }
      var wasmImports = {
        l: __abort_js,
        i: __emscripten_runtime_keepalive_clear,
        d: __gmtime_js,
        j: __setitimer_js,
        e: __tzset_js,
        k: _emscripten_date_now,
        a: _emscripten_resize_heap,
        b: _environ_get,
        c: _environ_sizes_get,
        f: _fd_close,
        g: _fd_write,
        h: _proc_exit
      };
      function run() {
        preRun();
        function doRun() {
          Module2["calledRun"] = true;
          if (ABORT) return;
          initRuntime();
          readyPromiseResolve?.(Module2);
          postRun();
        }
        {
          doRun();
        }
      }
      var wasmExports;
      wasmExports = await createWasm();
      run();
      if (runtimeInitialized) {
        moduleRtn = Module2;
      } else {
        moduleRtn = new Promise((resolve2, reject) => {
          readyPromiseResolve = resolve2;
          readyPromiseReject = reject;
        });
      }
      return moduleRtn;
    }
    if (typeof exports2 === "object" && typeof module2 === "object") {
      module2.exports = Module;
      module2.exports.default = Module;
    } else if (typeof define === "function" && define["amd"]) define([], () => Module);
  }
});

// node_modules/mediainfo.js/dist/cjs/mediaInfoFactory.cjs
var require_mediaInfoFactory = __commonJS({
  "node_modules/mediainfo.js/dist/cjs/mediaInfoFactory.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.default = void 0;
    var _MediaInfo = _interopRequireWildcard(require_MediaInfo());
    var _MediaInfoModule = _interopRequireDefault(require_MediaInfoModule());
    function _interopRequireDefault(e) {
      return e && e.__esModule ? e : { default: e };
    }
    function _interopRequireWildcard(e, t) {
      if ("function" == typeof WeakMap) var r = /* @__PURE__ */ new WeakMap(), n = /* @__PURE__ */ new WeakMap();
      return (_interopRequireWildcard = function(e2, t2) {
        if (!t2 && e2 && e2.__esModule) return e2;
        var o, i, f = { __proto__: null, default: e2 };
        if (null === e2 || "object" != typeof e2 && "function" != typeof e2) return f;
        if (o = t2 ? n : r) {
          if (o.has(e2)) return o.get(e2);
          o.set(e2, f);
        }
        for (const t3 in e2) "default" !== t3 && {}.hasOwnProperty.call(e2, t3) && ((i = (o = Object.defineProperty) && Object.getOwnPropertyDescriptor(e2, t3)) && (i.get || i.set) ? o(f, t3, i) : f[t3] = e2[t3]);
        return f;
      })(e, t);
    }
    var noopPrint = () => {
    };
    function defaultLocateFile(path, prefix) {
      try {
        const url = new URL(prefix);
        if (url.pathname === "/") {
          return `${prefix}mediainfo.js/dist/${path}`;
        }
      } catch {
      }
      return `${prefix}../${path}`;
    }
    function mediaInfoFactory2(options = {}, callback, errCallback) {
      if (callback === void 0) {
        return new Promise((resolve2, reject) => {
          mediaInfoFactory2(options, resolve2, reject);
        });
      }
      const {
        locateFile,
        ...mergedOptions
      } = {
        ..._MediaInfo.DEFAULT_OPTIONS,
        ...options,
        format: options.format ?? _MediaInfo.DEFAULT_OPTIONS.format
      };
      const mediaInfoModuleFactoryOpts = {
        // Silence all print in module
        print: noopPrint,
        printErr: noopPrint,
        locateFile: locateFile ?? defaultLocateFile,
        onAbort: (err) => {
          if (errCallback) {
            errCallback(err);
          }
        }
      };
      (0, _MediaInfoModule.default)(mediaInfoModuleFactoryOpts).then((wasmModule) => {
        callback(new _MediaInfo.default(wasmModule, mergedOptions));
      }).catch((error) => {
        if (errCallback) {
          errCallback(error);
        }
      });
    }
    var _default = exports2.default = mediaInfoFactory2;
  }
});

// node_modules/mediainfo.js/dist/cjs/typeGuard.cjs
var require_typeGuard = __commonJS({
  "node_modules/mediainfo.js/dist/cjs/typeGuard.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    exports2.isTrackType = isTrackType;
    function isTrackType(thing, type) {
      return thing !== null && typeof thing === "object" && thing["@type"] === type;
    }
  }
});

// node_modules/mediainfo.js/dist/cjs/index.cjs
var require_cjs = __commonJS({
  "node_modules/mediainfo.js/dist/cjs/index.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", {
      value: true
    });
    Object.defineProperty(exports2, "default", {
      enumerable: true,
      get: function() {
        return _mediaInfoFactory.default;
      }
    });
    Object.defineProperty(exports2, "isTrackType", {
      enumerable: true,
      get: function() {
        return _typeGuard.isTrackType;
      }
    });
    Object.defineProperty(exports2, "mediaInfoFactory", {
      enumerable: true,
      get: function() {
        return _mediaInfoFactory.default;
      }
    });
    var _mediaInfoFactory = _interopRequireDefault(require_mediaInfoFactory());
    var _typeGuard = require_typeGuard();
    function _interopRequireDefault(e) {
      return e && e.__esModule ? e : { default: e };
    }
  }
});

// src/main/services/media.ts
var import_mediainfo = __toESM(require_cjs(), 1);
var import_promises = require("node:fs/promises");
async function probeMedia(path, wasmPath) {
  const file = await (0, import_promises.open)(path, "r");
  const info = await (0, import_mediainfo.mediaInfoFactory)({
    format: "object",
    locateFile: () => wasmPath
  }).catch(async (error) => {
    await file.close();
    throw error;
  });
  try {
    const { size } = await file.stat();
    const result = await info.analyzeData(size, async (length, offset) => {
      const buffer = Buffer.alloc(Math.min(length, 4 * 1024 * 1024));
      const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
      return buffer.subarray(0, bytesRead);
    });
    const tracks = result.media?.track ?? [];
    const visual = tracks.find(
      (t) => t["@type"] === "Video" || t["@type"] === "Image"
    );
    const audio = tracks.find((t) => t["@type"] === "Audio");
    const general = tracks.find((t) => t["@type"] === "General");
    const visualData = visual ?? {};
    const generalData = general ?? {};
    const value = (v) => Number(v) > 0 ? Number(v) : void 0;
    return {
      width: visual && "Width" in visual ? value(visual.Width) : void 0,
      height: visual && "Height" in visual ? value(visual.Height) : void 0,
      fps: visual && "FrameRate" in visual ? value(visual.FrameRate) : void 0,
      sampleRate: audio && "SamplingRate" in audio ? value(audio.SamplingRate) : void 0,
      channels: audio && "Channels" in audio ? value(audio.Channels) : void 0,
      bitDepth: audio && "BitDepth" in audio ? value(audio.BitDepth) : void 0,
      duration: value(
        general?.Duration ?? (visual && "Duration" in visual ? visual.Duration : void 0) ?? audio?.Duration
      ),
      hasAlpha: String(visualData.Alpha ?? visualData.AlphaChannel ?? "").toLowerCase() === "yes",
      metadata: {
        mediaInfoFormat: String(generalData.Format ?? visualData.Format ?? "")
      }
    };
  } finally {
    info.close();
    await file.close();
  }
}

// scripts/bundle-smoke.ts
var import_node_path = require("node:path");
var import_strict = __toESM(require("node:assert/strict"), 1);
async function main() {
  const metadata = await probeMedia(
    (0, import_node_path.resolve)("tests/fixtures/sample.mp4"),
    (0, import_node_path.resolve)("resources/MediaInfoModule.wasm")
  );
  import_strict.default.equal(metadata.width, 640);
  import_strict.default.equal(metadata.fps, 30);
  console.log("Bundled MediaInfo reads real MP4 successfully.");
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
