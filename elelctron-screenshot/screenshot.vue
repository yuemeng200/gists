<template>
  <div id="layout">
    <div
      id="mask"
      @mousedown="onSelectRegion"
      v-if="displayMask"
      :style="{ cursor: completeSelectRegion ? 'default' : 'crosshair' }"
    ></div>

    <!-- caputure region -->
    <div id="captureRegion" :style="captureRegionStyle"></div>

    <canvas
      id="display-canvas"
      ref="display"
      v-show="completeSelectRegion"
      :style="{
        position: 'absolute',
        left: canvasX + 'px',
        top: canvasY + 'px',
        zIndex: 1004,
        pointerEvents: 'none',
      }"
    >
    </canvas>

    <!-- width/height：同上 -->
    <canvas
      id="assist-canvas"
      ref="assist"
      v-show="completeSelectRegion"
      :style="{
        position: 'absolute',
        left: canvasX + 'px',
        top: canvasY + 'px',
        zIndex: 1004,
        cursor: 'move',
      }"
      @mousedown="onDrag"
    >
    </canvas>
    <div
      class="toolbar"
      v-show="completeSelectRegion"
      v-position="{ x, y, width, height }"
    >
      <button @click="confirm">确定</button>
      <button @click="cancel">取消</button>
    </div>
    <!-- 桌面捕获 -->
    <canvas id="desktop-canvas" ref="desktop"></canvas>
    <video id="video"></video>
  </div>
</template>


<script>
import { remote, desktopCapturer, ipcRenderer } from "electron";
const { id, size } = remote.screen.getPrimaryDisplay(); //workAreaSize >= size,前者包含屏幕左右的黑边框

export default {
  name: "app",
  created() {
    ipcRenderer.on("screen:reload", () => {
      window.location.reload();
    });
    ipcRenderer.on("screen:shot", () => {
      this.captureScreen();
    });
  },
  data() {
    return {
      win: null,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      win32: process.platform === "win32",

      isCapture: false,
      completeSelectRegion: false,
      canDrag: true,
      displayMask: false,
      captureRegionStyle: {
        position: "absolute",
        zIndex: 1003,
        // cursor:'move',
        background: "rgba(0,0,0,0)",
        draggable: false,
        borderWidth: "2px",
        borderColor: "white",
        borderStyle: "solid",
        boxShadow: "0px 0px 2px 2px rgba(85, 80, 80, 0.3)",
        left: "0px", // =this.x
        top: "0px", // = this.y
        width: "0px", //this.width
        height: "0px", //this.height
      },
    };
  },
  directives: {
    position: function (el, binding) {
      //bind + update
      let { x, y, width, height } = binding.value;
      const { clientWidth, clientHeight } = document.body;
      const toolbarLength = 555;
      const toolbarHeight = 40;
      const isBeyondLeft = (toolbarLength - width) / 2 > x; //左边碰壁了
      const isBeyondRight =
        (toolbarLength - width) / 2 > clientWidth - x - width; //右边碰壁了
      const isBeyondBottom = toolbarHeight + 20 > clientHeight - y - height; //下边碰壁了

      el.style.position = "absolute";
      el.style.zIndex = 2000;
      el.style.left = isBeyondLeft
        ? "10px"
        : isBeyondRight
        ? clientWidth - toolbarLength - 20 + "px"
        : x + width / 2 - toolbarLength / 2 + "px";
      el.style.top = isBeyondBottom ? y - 60 + "px" : y + height + 40 + "px";
    },
  },
  computed: {
    canvasX() {
      return this.x + parseInt(this.captureRegionStyle.borderWidth);
    },
    canvasY() {
      return this.y + parseInt(this.captureRegionStyle.borderWidth);
    },
    canvasWidth() {
      let width =
        this.width - 2 * parseInt(this.captureRegionStyle.borderWidth);
      return width > 0 ? width : 0;
    },
    canvasHeight() {
      let height =
        this.height - 2 * parseInt(this.captureRegionStyle.borderWidth);
      return height > 0 ? height : 0;
    },
  },
  methods: {
    clipDesktop() {
      let desktop = this.$refs.desktop;
      const ctx = this.$refs.display.getContext("2d");
      ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
      ctx.drawImage(
        desktop,
        this.canvasX,
        this.canvasY,
        this.canvasWidth,
        this.canvasHeight,
        0,
        0,
        this.canvasWidth,
        this.canvasHeight
      );
      ctx.globalCompositeOperation = "source-over";
    },
    initSelect() {
      //每次选择区域前初始化选区状态,也就是"取消"工具按钮作用
      this.completeSelectRegion = false;
      this.isCapture = false;
      this.canDrag = true;
      this.captureRegionStyle.left = "0px";
      this.captureRegionStyle.top = "0px";
      this.captureRegionStyle.width = "0px";
      this.captureRegionStyle.height = "0px";
    },
    onSelectRegion(e) {
      //鼠标按下开始截图
      if (this.completeSelectRegion) {
        return false;
      } //选区成功后，不可再点击，除非点击"取消"重新选

      // if(this.showPixelCanvas){
      //   return false
      // } //像素查看时，不可进行截图选取

      this.initSelect();
      this.x = e.clientX;
      this.y = e.clientY;
      this.captureRegionStyle.left = this.x + "px";
      this.captureRegionStyle.top = this.y + "px";

      document.onmousemove = (e) => {
        const width = e.clientX - this.x; //可能反向选区,就为负数
        const height = e.clientY - this.y;

        // 判断是否是在截图，而不是纯粹点击鼠标等普通操作
        this.isCapture = width > 15; //width<0是反向选区，但反向选区遇到bug，尚未解决
        if (this.isCapture) {
          //是在截图进行选区,更新宽高
          this.width = width;
          this.height = height;
          this.captureRegionStyle.width = this.width + "px";
          this.captureRegionStyle.height = this.height + "px";
        }
      };
      document.onmouseup = () => {
        //BUG:偶尔丢失mouseup事件，我鼠标问题吗？
        //放开鼠标，清除移动事件，生成选区
        document.onmousemove = null;
        this.completeSelectRegion = this.canDrag = this.isCapture;

        //-------设置宽高、清空画布都会使canvas状态清空，所以在这里处理高dpi模糊问题
        this.setCanvas(this.$refs.display, this.canvasWidth, this.canvasHeight);
        this.setCanvas(this.$refs.assist, this.canvasWidth, this.canvasHeight);
        //-------
        this.clipDesktop();
      };
    },
    onDrag(e) {
      if (this.completeSelectRegion && this.canDrag) {
        // 鼠标点击物体那一刻相对于物体左侧边框的距离=点击时的位置相对于浏览器
        // 最左边的距离-物体左边框相对于浏览器最左边的距离，纵向同理
        const leftWidth = e.clientX - this.x;
        const topHeight = e.clientY - this.y;

        document.onmousemove = (e) => {
          this.completeSelectRegion = false; //移动时意味着重新选区，未完成选区隐藏工具条

          // 控制拖拽物体的范围只能在浏览器视窗内，不允许出现滚动条或拖出可视区域
          let posX = e.clientX - leftWidth;
          let posY = e.clientY - topHeight;

          if (posX < 0) {
            posX = 0;
          } else if (posX > document.body.clientWidth - this.width) {
            posX = document.body.clientWidth - this.width;
          }

          if (posY < 0) {
            posY = 0;
          } else if (posY > document.body.clientHeight - this.height) {
            posY = document.body.clientHeight - this.height;
          }

          //拖动
          this.x = posX;
          this.y = posY;
          this.captureRegionStyle.left = this.x + "px";
          this.captureRegionStyle.top = this.y + "px";
        };

        document.onmouseup = () => {
          // 鼠标抬起时不再移动
          // 预防鼠标弹起来后还会循环（即预防鼠标放上去的时候还会移动）
          document.onmousemove = null;
          this.completeSelectRegion = true; //重新选取完成，显示工具条

          //-------设置宽高、清空画布都会使canvas状态清空，所以在这里处理高dpi模糊问题
          this.setCanvas(
            this.$refs.display,
            this.canvasWidth,
            this.canvasHeight
          );
          this.setCanvas(
            this.$refs.assist,
            this.canvasWidth,
            this.canvasHeight
          );
          //------
          this.clipDesktop();
        };
      }
    },
    confirm() {
      this.captureRegionStyle.borderWidth = "0";
      this.completeSelectRegion = false;
      ipcRenderer.invoke(
        "screen:confirm",
        this.$refs.display.toDataURL("image/jpg")
      );
    },
    cancel() {
      this.captureRegionStyle.borderWidth = "0";
      this.completeSelectRegion = false;
      ipcRenderer.invoke("screen:cancel");
      this.$emit("onCancel");
    },
    setCanvas(canvas, width, height) {
      let ctx = canvas.getContext("2d");
      let backingStorePixelRatio =
        ctx.backingStorePixelRatio ||
        ctx.webkitBackingStorePixelRatio ||
        ctx.mozBackingStorePixelRatio ||
        ctx.msBackingStorePixelRatio ||
        ctx.oBackingStorePixelRatio ||
        ctx.backingStorePixelRatio ||
        1;

      const pixelRatio =
        (window.devicePixelRatio || 1) / backingStorePixelRatio; //获得屏幕像素比，进行缩放，否则绘制会出现模糊
      canvas.width = width * pixelRatio; //相应缩放画布
      canvas.height = height * pixelRatio;
      ctx.scale(pixelRatio, pixelRatio);

      canvas.style.width = width + "px"; //实际按照屏幕大小绘制
      canvas.style.height = height + "px";

      return ctx;
    },

    captureScreen() {
      if (process.platform === "win32") {
        //老坑：desktopCapture=>linux下无效
        desktopCapturer
          .getSources({
            types: ["screen"],
            thumbnailSize: { width: 0, height: 0 },
          })
          .then(async (sources) => {
            for (let source of sources) {
              // console.log(typeof source.display_id) //坑
              // console.log(typeof id) //坑
              if (source.display_id === id.toString()) {
                const stream = await navigator.mediaDevices.getUserMedia({
                  audio: false,
                  video: {
                    mandatory: {
                      chromeMediaSource: "desktop",
                      chromeMediaSourceId: source.id,
                      minWidth: size.width,
                      maxWidth: size.width,
                      minHeight: size.height,
                      maxHeight: size.height,
                    },
                  },
                });
                this.handleStream(stream);
              }
            }
          });
      } else {
        //linux
        navigator.mediaDevices
          .getUserMedia({
            audio: false,
            video: {
              mandatory: {
                chromeMediaSource: "desktop",
                // chromeMediaSourceId: source.id, //出现NotReadableError,是因为getPrimaryDisplay()返回的id不一致，不做多屏幕直接去掉就可以了
                minWidth: size.width,
                maxWidth: size.width,
                minHeight: size.height,
                maxHeight: size.height,
              },
            },
          })
          .then((stream) => this.handleStream(stream));
      }
    },

    handleStream(stream) {
      const video = document.getElementById("video");
      video.srcObject = stream;
      video.onloadedmetadata = () => {
        video.play();

        let canvas = document.getElementById("desktop-canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        canvas.style.width = size.width + "px"; //实际按照屏幕大小绘制
        canvas.style.height = size.height + "px";

        const ctx = canvas.getContext("2d");

        // ctx.drawImage(video,0, 0)
        ctx.clearRect(0, 0, size.width, size.height);
        createImageBitmap(video).then((bmp) => {
          //转为bitmap，可以提高性能，降低canvas渲染延迟
          // ctx.imageSmoothingEnabled = false;
          ctx.drawImage(bmp, 0, 0); //startX,startY,width,height  in canvas
          this.displayMask = true;
          stream.getTracks()[0].stop(); //关闭视频流，序号是反向的，此处只有一个所以是0
          // 移除video元素
          //      document.getElementById('layout').removeChild(video)
        });
      };
    },
  },
};
</script>

<style>
#layout {
  position: fixed;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  z-index: 999;
}
#mask {
  width: 100%;
  height: 100%;
  z-index: 1002;
  position: absolute;
  top: 0px;
  left: 0px;
  background: rgb(0, 0, 0, 0.5);
}

#desktop-canvas,
#video {
  position: absolute;
  top: 0px;
  left: 0px;
  z-index: -999;
  width: 100%;
  height: 100%;
  pointer-events: none;
  visibility: hidden;
}
.toolbar {
  background: white;
  color: black;
}
html,
body {
  background: rgba(0, 0, 0, 0);
}
</style>
