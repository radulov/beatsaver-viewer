import { toLong } from 'ip';
import {BEAT_WARMUP_OFFSET, BEAT_WARMUP_SPEED, BEAT_WARMUP_TIME} from '../constants/beat';
const COLORS = require('../constants/colors.js');

const auxObj3D = new THREE.Object3D();
const collisionZThreshold = -2.6;
const BEAT_WARMUP_ROTATION_CHANGE = Math.PI / 5;
const BEAT_WARMUP_ROTATION_OFFSET = 0.4;
const BEAT_WARMUP_ROTATION_TIME = 0.75;
const DESTROYED_SPEED = 1.0;
const SWORD_OFFSET = 1.5;
const ONCE = {once: true};

const SCORE_POOL = {
  OK : 'pool__beatscoreok',
  GOOD : 'pool__beatscoregood',
  GREAT : 'pool__beatscoregreat',
  SUPER : 'pool__beatscoresuper'
};

function getHorizontalPosition (lineIndex) {
  return lineIndex / 3 * 1.5 - 0.75
}

function getVerticalPosition (lineLayer) {
  return lineLayer / 2 + 0.7;
}

/**
 * Bears, beats, Battlestar Galactica.
 * Create beat from pool, collision detection, movement, scoring.
 */
AFRAME.registerComponent('beat', {
  schema: {
    index: {default: 0},
    anticipationPosition: {default: 0},
    color: {default: 'red', oneOf: ['red', 'blue']},
    cutDirection: {default: 'down'},
    debug: {default: false},
    horizontalPosition: {default: 1},
    size: {default: 0.40},
    speed: {default: 8.0},
    type: {default: 'arrow', oneOf: ['arrow', 'dot', 'mine']},
    verticalPosition: {default: 1},
    warmupPosition: {default: 0},
    time: {default: 0},
    anticipationTime: {default: 0},
    warmupTime: {default: 0},
    warmupSpeed: {default: 0},
  },

  materialColor: {
    blue: COLORS.BEAT_BLUE,
    red: COLORS.BEAT_RED
  },

  cutColor: {
    blue: '#fff',
    red: '#fff'
  },

  models: {
    arrow: 'beatObjTemplate',
    dot: 'beatObjTemplate',
    mine: 'mineObjTemplate'
  },

  signModels: {
    arrowred: 'arrowRedObjTemplate',
    arrowblue: 'arrowBlueObjTemplate',
    dotred: 'dotRedObjTemplate',
    dotblue: 'dotBlueObjTemplate'
  },

  orientations: [180, 0, 270, 90, 225, 135, 315, 45, 0],

  rotations: {
    up: 180,
    down: 0,
    left: 270,
    right: 90,
    upleft: 225,
    upright: 135,
    downleft: 315,
    downright: 45
  },

  horizontalPositions: {
    left: -0.75,
    middleleft: -0.25,
    middleright: 0.25,
    right: 0.75
  },

  verticalPositions: {
    bottom: 0.70,
    middle: 1.20,
    top: 1.70
  },

  init: function () {
    this.beams = document.getElementById('beams').components.beams;
    this.beatBoundingBox = new THREE.Box3();
    this.currentRotationWarmupTime = 0;
    this.cutDirection = new THREE.Vector3();
    this.destroyed = false;
    this.gravityVelocity = 0;
    this.hitEventDetail = {};
    this.hitBoundingBox = new THREE.Box3();
    this.poolName = undefined;
    this.returnToPoolTimeStart = undefined;
    this.rotationAxis = new THREE.Vector3();
    this.saberEls = this.el.sceneEl.querySelectorAll('[saber-controls]');
    this.headset = this.el.sceneEl.querySelectorAll('.headset')[0];
    this.replayLoader = this.el.sceneEl.components['replay-loader'];
    this.settings = this.el.sceneEl.components['settings'];
    this.frameNum = 0;
    this.scoreEl = null;
    this.scoreElTime = undefined;
    this.startPositionZ = undefined;
    this.rightCutPlanePoints = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ];
    this.leftCutPlanePoints = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ];

    this.mineParticles = document.getElementById('mineParticles');
    this.wrongElLeft = document.getElementById('wrongLeft');
    this.wrongElRight = document.getElementById('wrongRight');
    this.missElLeft = document.getElementById('missLeft');
    this.missElRight = document.getElementById('missRight');
    this.particles = document.getElementById('saberParticles');

    this.superCuts = document.querySelectorAll('.superCutFx');
    this.superCutIdx = 0;

    this.explodeEventDetail = {position: new THREE.Vector3(), rotation: new THREE.Euler()};
    this.saberColors = {right: 'blue', left: 'red'};
    this.glow = null;
    this.song = this.el.sceneEl.components.song;

    this.onEndStroke = this.onEndStroke.bind(this);

    this.initBlock();
    if (this.data.type === 'mine') {
      this.initMineFragments();
    } else {
      this.initFragments();
    };
  },

  update: function () {
    this.updateBlock();
    this.updateFragments();

    if (this.data.type === 'mine') {
      this.poolName = `pool__beat-mine`;
    } else {
      this.poolName = `pool__beat-${this.data.type}-${this.data.color}`;
    }
  },

  pause: function () {
    this.el.object3D.visible = false;
    if (this.data.type !== 'mine') {
      this.partLeftEl.object3D.visible = false;
      this.partRightEl.object3D.visible = false;
    }
  },

  play: function () {
    // this.glow = this.el.sceneEl.components['pool__beat-glow'].requestEntity();
    if (!this.hitSaberEl) {
      this.blockEl.object3D.visible = true;
      this.destroyed = false;
      this.el.object3D.visible = true;
    }
  },

  tock: function (time, timeDelta) {
    const el = this.el;
    const data = this.data;
    const position = el.object3D.position;
    const rotation = el.object3D.rotation;
    const song = this.song;

    if (this.destroyed) {
      this.tockDestroyed(timeDelta);
      // Check to remove score entity from pool.
    } else {
      if (position.z > collisionZThreshold) { this.checkCollisions(); }

      var newPosition = 0;

      var timeOffset = data.time - song.getCurrentTime() - data.anticipationTime - data.warmupTime;
      var currentRotationWarmupTime = timeOffset;

      if (timeOffset <= -data.warmupTime) {
        newPosition = data.anticipationPosition;
        timeOffset += data.warmupTime;
        newPosition += -timeOffset * data.speed;
        if (!this.settings.settings.noEffects && Math.abs(timeOffset) < 1) {
          this.beams.newBeam(data.color, data.anticipationPosition);
        }
      } else {
        newPosition = data.anticipationPosition + data.warmupPosition + data.warmupSpeed * -timeOffset;
      }

      newPosition += this.headset.object3D.position.z;
      position.z = newPosition;

      if (currentRotationWarmupTime <= -data.warmupTime) {
        currentRotationWarmupTime += data.warmupTime;

        let warmupRotationTime = BEAT_WARMUP_ROTATION_TIME / (20 / data.anticipationPosition); // Closer anticipation - faster the rotation.
          
        const progress = warmupRotationTime <= currentRotationWarmupTime ? AFRAME.ANIME.easings.easeOutBack(
          currentRotationWarmupTime / warmupRotationTime) : 1.0;
          el.object3D.rotation.z = this.rotationZStart + (progress * this.rotationZChange);
      }

      this.backToPool = position.z >= 2;
        if (this.backToPool) { this.missHit(); }
    }
    this.returnToPool();
  },

  /**
   * Called when summoned by beat-generator.
   */
  onGenerate: function () {
    const data = this.data;
    const el = this.el;

    // Set position.
    el.object3D.position.set(
      getHorizontalPosition(data.horizontalPosition),
      getVerticalPosition(data.verticalPosition),
      data.anticipationPosition + data.warmupPosition
    );
    el.object3D.rotation.z = THREE.Math.degToRad(this.rotations[data.cutDirection]);

    // Set up rotation warmup.
    this.startRotationZ = this.el.object3D.rotation.z;
    this.currentRotationWarmupTime = 0;
    this.rotationZChange = BEAT_WARMUP_ROTATION_CHANGE;
    if (Math.random > 0.5) { this.rotationZChange *= -1; }
    this.el.object3D.rotation.z -= this.rotationZChange;
    this.rotationZStart = this.el.object3D.rotation.z;
    this.hitSaberEl = null;
    this.replayNote = null;
    
    // Reset mine.
    if (data.type == 'mine') { 
      this.resetMineFragments();
      this.blockEl.getObject3D('mesh').material = this.el.sceneEl.systems.materials['mineMaterial' + this.data.color];
      const bombs = this.replayLoader.bombs;
      if (bombs) {
        for (var i = 0; i < bombs.length; i++) {
          if (bombs[i].time < (data.time + 0.08) && bombs[i].time > data.time - 0.08) {
            this.replayNote = bombs[i];
            break;
          }
        }
      }
    } else {
      const notes = this.replayLoader.allStructs;
      const index = this.data.index;
      var result;
      for (var i = 0; i < notes.length; i++) {
        if (notes[i].index == index) {
          result = notes[i];
          break;
        }
      }
      this.replayNote = result;
    }

    if (this.settings.settings.highlightErrors && this.replayNote && this.replayNote.score < 0) {
      if (data.type == 'mine') {
        this.blockEl.getObject3D('mesh').material = this.el.sceneEl.systems.materials['mineMaterialyellow'];
      } else {
        this.blockEl.setAttribute('material', "color: yellow");
      }
      
    }

    this.returnToPoolTimeStart = undefined;

    if (this.settings.settings.showHitboxes) {
      if (!this.hitbox) {
        let itsMine = this.data.type === 'mine';
        const hitbox = new THREE.WireframeGeometry(itsMine ? new THREE.SphereGeometry(0.18, 16, 8) : new THREE.BoxGeometry(0.8, 0.5, 1.0));
        const material = new THREE.LineBasicMaterial({
          color: 0xff0000,
          linewidth: 1
        });
        const line = new THREE.LineSegments( hitbox, material);
          
        el.object3D.add(line);
        if (!itsMine) {
          line.position.z += 0.25;
        }
        this.hitbox = line;
      }
    } else if (this.hitbox) {
      el.object3D.remove(this.hitbox);
      this.hitbox = null;
    }
  },

  initBlock: function () {
    var el = this.el;
    var blockEl = this.blockEl = document.createElement('a-entity');
    var signEl = this.signEl = document.createElement('a-entity');

    // Small offset to prevent z-fighting when the blocks are far away
    signEl.object3D.position.z += 0.02;
    blockEl.appendChild(signEl);
    el.appendChild(blockEl);
  },

  updateBlock: function () {
    const blockEl = this.blockEl;
    const signEl = this.signEl;
    if (!blockEl) { return; }

    blockEl.setAttribute('material', {
      metalness: 0.7,
      roughness: 0.1,
      sphericalEnvMap: '#envmapTexture',
      emissive: this.materialColor[this.data.color],
      emissiveIntensity: 0.05,
      color: this.materialColor[this.data.color]
    });
    this.setObjModelFromTemplate(blockEl, this.models[this.data.type]);

    // Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
    blockEl.object3D.scale.set(1, 1, 1);
    blockEl.object3D.scale.multiplyScalar(3.45).multiplyScalar(this.data.size);

    if (this.data.type === 'mine') {
      const model = blockEl.getObject3D('mesh');
      if (model) {
        model.material = this.el.sceneEl.systems.materials['mineMaterial' + this.data.color];
      } else {
        blockEl.addEventListener('model-loaded', () => {
          model.material = this.el.sceneEl.systems.materials['mineMaterial' + this.data.color];
        }, ONCE);
      }
    } else {
      signEl.setAttribute('materials', "name: clearStageAdditive");
      this.setObjModelFromTemplate(signEl, this.signModels[this.data.type + this.data.color]);
    }
  },

  initFragments: function () {
    var cutEl;
    var partEl;

    partEl = this.partLeftEl = document.createElement('a-entity');
    cutEl = this.cutLeftEl = document.createElement('a-entity');

    partEl.appendChild(cutEl);
    this.el.appendChild(partEl);

    partEl = this.partRightEl = document.createElement('a-entity');
    cutEl = this.cutRightEl = document.createElement('a-entity');

    partEl.appendChild(cutEl);
    this.el.appendChild(partEl);

    this.initCuttingClippingPlanes();
  },

  initMineFragments: function () {
    var fragment;
    var fragments = this.el.sceneEl.systems['mine-fragments-loader'].fragments.children;
    var material = this.el.sceneEl.systems.materials['mineMaterial' + this.data.color];

    this.randVec = new THREE.Vector3(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI);

    this.mineFragments = [];
    this.mineBroken = document.createElement('a-entity');
    this.el.appendChild(this.mineBroken);

    for (var i = 0; i < fragments.length; i++) {
      fragment = new THREE.Mesh(fragments[i].geometry, material);
      fragment.speed = new THREE.Vector3();
      fragment.speed.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      this.mineFragments.push(fragment);
      this.mineBroken.object3D.add(fragment);
    }
  },

  updateFragments: function () {
    var cutLeftEl = this.cutLeftEl;
    var cutRightEl = this.cutRightEl;
    var partLeftEl = this.partLeftEl;
    var partRightEl = this.partRightEl;
    var fragment;
    if (!partLeftEl) { return; }
    if (this.data.type === 'mine') {
      this.resetMineFragments();
      return;
    }

    partLeftEl.setAttribute('material', {
      metalness: 0.7,
      roughness: 0.1,
      sphericalEnvMap: '#envmapTexture',
      emissive: this.materialColor[this.data.color],
      emissiveIntensity: 0.05,
      color: this.materialColor[this.data.color],
      side: 'double'
    });
    this.setObjModelFromTemplate(partLeftEl, this.models.dot);
    // Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
    partLeftEl.object3D.scale.set(1, 1, 1);
    partLeftEl.object3D.scale.multiplyScalar(3.45).multiplyScalar(this.data.size);
    partLeftEl.object3D.visible = false;

    cutLeftEl.setAttribute('material', {
      shader: 'flat',
      color: this.data.cutColor,
      side: 'double'
    });
    this.setObjModelFromTemplate(cutLeftEl, this.models.dot);

    partRightEl.setAttribute('material', {
      metalness: 0.7,
      roughness: 0.1,
      sphericalEnvMap: '#envmapTexture',
      emissive: this.materialColor[this.data.color],
      emissiveIntensity: 0.05,
      color: this.materialColor[this.data.color],
      side: 'double'
    });
    this.setObjModelFromTemplate(partRightEl, this.models.dot);
    // Model is 0.29 size. We make it 1.0 so we can easily scale based on 1m size.
    partRightEl.object3D.scale.set(1, 1, 1);
    partRightEl.object3D.scale.multiplyScalar(3.45).multiplyScalar(this.data.size);
    partRightEl.object3D.visible = false;

    cutRightEl.setAttribute('material', {
      shader: 'flat',
      color: this.data.cutColor,
      side: 'double'
    });
    this.setObjModelFromTemplate(cutRightEl, this.models.dot);
  },

  resetMineFragments: function () {
    if (this.data.type !== 'mine') { return; }
    for (let i = 0; i < this.mineFragments.length; i++) {
      let fragment = this.mineFragments[i];
      fragment.visible = false;
      fragment.position.set(0, 0, 0);
      fragment.scale.set(1, 1, 1);
      fragment.speed.set(
        Math.random() * 5 - 2.5,
        Math.random() * 5 - 2.5,
        Math.random() * 5 - 2.5);
    }
  },

  missHit: function (hand) {
    if (this.data.type === 'mine') {
      if (this.replayNote) {
        this.postScoreEvent();
      }
      return; 
    }
    
    this.postScoreEvent();
    this.showScore(hand);
    
    if (AFRAME.utils.getUrlParameter('synctest')) {
      console.log(this.el.sceneEl.components.song.getCurrentTime());
    }
  },

  postScoreEvent: function () {
      this.el.emit('scoreChanged', {index: this.replayNote.i}, true);
  },

  destroyMine: function () {
    if (!this.settings.settings.reducedDebris) {
      for (let i = 0; i < this.mineFragments.length; i++) {
        this.mineFragments[i].visible = true;
      }
  
      this.blockEl.object3D.visible = false;
      this.destroyed = true;
      this.gravityVelocity = 0.1;
      this.returnToPoolTimer = 800;
    }
    
    if (!this.settings.settings.noEffects) {
      this.explodeEventDetail.position.copy(this.el.object3D.position);
      this.explodeEventDetail.rotation.copy(this.randVec);
      this.mineParticles.emit('explode', this.explodeEventDetail, false);
    }
  },

  destroyBeat: (function () {
    var parallelPlaneMaterial = new THREE.MeshBasicMaterial({
      color: '#00008b',
      side: THREE.DoubleSide
    });
    var planeMaterial = new THREE.MeshBasicMaterial({color: 'grey', side: THREE.DoubleSide});
    var point1 = new THREE.Vector3();
    var point2 = new THREE.Vector3();
    var point3 = new THREE.Vector3();

    return function (saberEl) {

      if (!this.settings.settings.reducedDebris) {
        var coplanarPoint;
        var cutThickness = this.cutThickness = 0.02;
        var direction = this.cutDirection;
        var leftBorderInnerPlane = this.leftBorderInnerPlane;
        var leftBorderOuterPlane = this.leftBorderOuterPlane;
        var leftCutPlane = this.leftCutPlane;
        var planeGeometry;
        var planeMesh;
        var rightBorderInnerPlane = this.rightBorderInnerPlane;
        var rightBorderOuterPlane = this.rightBorderOuterPlane;
        var rightCutPlane = this.rightCutPlane;
        var trailPoints = saberEl.components.trail.saberTrajectory;

        point1.copy(trailPoints[0].top);
        point2.copy(trailPoints[0].center);
        point3.copy(trailPoints[trailPoints.length - 1].top);
        direction.copy(point1).sub(point3);

        this.partRightEl.object3D.position.set(0, 0, 0);
        this.partRightEl.object3D.rotation.set(0, 0, 0);
        this.partRightEl.object3D.updateMatrixWorld();

        this.partRightEl.object3D.worldToLocal(this.rightCutPlanePoints[0].copy(point1));
        this.partRightEl.object3D.worldToLocal(this.rightCutPlanePoints[1].copy(point2));
        this.partRightEl.object3D.worldToLocal(this.rightCutPlanePoints[2].copy(point3));

        this.partLeftEl.object3D.position.set(0, 0, 0);
        this.partLeftEl.object3D.rotation.set(0, 0, 0);
        this.partLeftEl.object3D.updateMatrixWorld();

        this.partLeftEl.object3D.worldToLocal(this.leftCutPlanePoints[0].copy(point3));
        this.partLeftEl.object3D.worldToLocal(this.leftCutPlanePoints[1].copy(point2));
        this.partLeftEl.object3D.worldToLocal(this.leftCutPlanePoints[2].copy(point1));

        this.generateCutClippingPlanes();

        if (this.data.debug) {
          coplanarPoint = new THREE.Vector3();
          planeGeometry = new THREE.PlaneGeometry(4.0, 4.0, 1.0, 1.0);

          rightCutPlane.coplanarPoint(coplanarPoint);
          planeGeometry.lookAt(rightCutPlane.normal);
          planeGeometry.translate(coplanarPoint.x, coplanarPoint.y, coplanarPoint.z);

          planeMesh = new THREE.Mesh(planeGeometry, planeMaterial);
          this.el.sceneEl.setObject3D('rightCutPlane', planeMesh);

          planeGeometry = new THREE.PlaneGeometry(4.0, 4.0, 1.0, 1.0);

          rightBorderOuterPlane.coplanarPoint(coplanarPoint);
          planeGeometry.lookAt(rightBorderOuterPlane.normal);
          planeGeometry.translate(coplanarPoint.x, coplanarPoint.y, coplanarPoint.z);

          const parallelPlaneMesh = new THREE.Mesh(planeGeometry, parallelPlaneMaterial);
          this.el.sceneEl.setObject3D('planeParallel', parallelPlaneMesh);
        }

        this.blockEl.object3D.visible = false;

        const partRightMaterial = this.partRightEl.getObject3D('mesh').material;
        partRightMaterial.clippingPlanes = partRightMaterial.clippingPlanes || [];
        partRightMaterial.clippingPlanes.length = 0;
        partRightMaterial.clippingPlanes.push(rightCutPlane);

        const cutRightMaterial = this.cutRightEl.getObject3D('mesh').material;
        cutRightMaterial.clippingPlanes = cutRightMaterial.clippingPlanes || [];
        cutRightMaterial.clippingPlanes.length = 0;
        cutRightMaterial.clippingPlanes.push(rightBorderOuterPlane);
        cutRightMaterial.clippingPlanes.push(rightBorderInnerPlane);

        const partLeftMaterial = this.partLeftEl.getObject3D('mesh').material;
        partLeftMaterial.clippingPlanes = partLeftMaterial.clippingPlanes || [];
        partLeftMaterial.clippingPlanes.length = 0;
        partLeftMaterial.clippingPlanes.push(leftCutPlane);

        const cutLeftMaterial = this.cutLeftEl.getObject3D('mesh').material;
        cutLeftMaterial.clippingPlanes = cutLeftMaterial.clippingPlanes || [];
        cutLeftMaterial.clippingPlanes.length = 0;
        cutLeftMaterial.clippingPlanes.push(leftBorderInnerPlane);
        cutLeftMaterial.clippingPlanes.push(leftBorderOuterPlane);

        this.partLeftEl.object3D.visible = true;
        this.partRightEl.object3D.visible = true;

        this.el.sceneEl.renderer.localClippingEnabled = true;
        this.destroyed = true;
        this.gravityVelocity = 0.1;

        this.rotationAxis.copy(this.rightCutPlanePoints[0]).sub(this.rightCutPlanePoints[1]);

        this.returnToPoolTimer = 800;

        auxObj3D.up.copy(rightCutPlane.normal);
        auxObj3D.lookAt(direction);
      } else {
        this.returnToPool(true);
      }

      if (!this.settings.settings.noEffects) {
        this.explodeEventDetail.position = this.el.object3D.position;
        this.explodeEventDetail.rotation = auxObj3D.rotation;
        this.particles.emit('explode', this.explodeEventDetail, false);
      }
    };
  })(),

  initCuttingClippingPlanes: function () {
    this.leftCutPlanePointsWorld = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ];
    this.rightCutPlanePointsWorld = [
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3()
    ];

    this.rightCutPlane = new THREE.Plane();
    this.rightBorderOuterPlane = new THREE.Plane();
    this.rightBorderInnerPlane = new THREE.Plane();

    this.leftCutPlane = new THREE.Plane();
    this.leftBorderOuterPlane = new THREE.Plane();
    this.leftBorderInnerPlane = new THREE.Plane();
  },

  generateCutClippingPlanes: function () {
    var leftBorderInnerPlane = this.leftBorderInnerPlane;
    var leftBorderOuterPlane = this.leftBorderOuterPlane;
    var leftCutPlane = this.leftCutPlane;
    var leftCutPlanePointsWorld = this.leftCutPlanePointsWorld;
    var partLeftEl = this.partLeftEl;
    var partRightEl = this.partRightEl;
    var rightBorderInnerPlane = this.rightBorderInnerPlane;
    var rightBorderOuterPlane = this.rightBorderOuterPlane;
    var rightCutPlane = this.rightCutPlane;
    var rightCutPlanePointsWorld = this.rightCutPlanePointsWorld;

    partRightEl.object3D.updateMatrixWorld();
    partRightEl.object3D.localToWorld(
      rightCutPlanePointsWorld[0].copy(this.rightCutPlanePoints[0]));
    partRightEl.object3D.localToWorld(
      rightCutPlanePointsWorld[1].copy(this.rightCutPlanePoints[1]));
    partRightEl.object3D.localToWorld(
      rightCutPlanePointsWorld[2].copy(this.rightCutPlanePoints[2]));

    partLeftEl.object3D.updateMatrixWorld();
    partLeftEl.object3D.localToWorld(
      leftCutPlanePointsWorld[0].copy(this.leftCutPlanePoints[0]));
    partLeftEl.object3D.localToWorld(
      leftCutPlanePointsWorld[1].copy(this.leftCutPlanePoints[1]));
    partLeftEl.object3D.localToWorld(
      leftCutPlanePointsWorld[2].copy(this.leftCutPlanePoints[2]));

    rightCutPlane.setFromCoplanarPoints(
      rightCutPlanePointsWorld[0], rightCutPlanePointsWorld[1], rightCutPlanePointsWorld[2]);
    rightBorderOuterPlane.set(rightCutPlane.normal,
                              rightCutPlane.constant + this.cutThickness);

    leftCutPlane.setFromCoplanarPoints(
      leftCutPlanePointsWorld[0], leftCutPlanePointsWorld[1], leftCutPlanePointsWorld[2]);
    leftBorderOuterPlane.set(leftCutPlane.normal, leftCutPlane.constant + this.cutThickness);

    rightBorderInnerPlane.setFromCoplanarPoints(
      rightCutPlanePointsWorld[2], rightCutPlanePointsWorld[1], rightCutPlanePointsWorld[0]);
    leftBorderInnerPlane.setFromCoplanarPoints(
      leftCutPlanePointsWorld[2], leftCutPlanePointsWorld[1], leftCutPlanePointsWorld[0]);
  },

  returnToPool: function (force) {
    if (!this.backToPool && !force) { return; }
    this.el.sceneEl.components[this.poolName].returnEntity(this.el);
  },

  checkCollisions: function () {
    // const cutDirection = this.data.cutDirection;
    const saberEls = this.saberEls;

    const beatSmallBoundingBox = this.beatBoundingBox.setFromObject(
      this.blockEl.getObject3D('mesh'));
    const beatBigBoundingBox = this.beatBoundingBox.setFromObject(
        this.blockEl.getObject3D('mesh'));
    if (this.data.type != 'mine') {
      beatBigBoundingBox.expandByVector(new THREE.Vector3(0.181, 0.05, 0.3));
      beatBigBoundingBox.translate(new THREE.Vector3(0.0, 0.0, 0.25))
    }
    
    // const position = this.el.object3D.position;

    for (let i = 0; i < saberEls.length; i++) {
      let saberControls = saberEls[i].components['saber-controls'];
      let saberBoundingBox = saberControls.boundingBox;
      // let maxAngle;

      if (!saberBoundingBox) { break; }

      // const hand = saberControls.hand;

      if (saberBoundingBox.intersectsBox(beatSmallBoundingBox) || (saberBoundingBox.intersectsBox(beatBigBoundingBox))) {

        // Sound.
        this.el.parentNode.components['beat-hit-sound'].playSound(this.el);

        if (this.data.type === 'mine') {
          if (this.replayNote) {
            this.postScoreEvent();
          }
          
          this.destroyMine();
          
          break;
        }

        this.postScoreEvent();
        this.destroyBeat(saberEls[i]);
        
        this.hitSaberEl = saberEls[i];
        if (this.settings.settings.reducedDebris) {
          this.onEndStroke();
        } else {
          this.hitSaberEl.addEventListener('strokeend', this.onEndStroke, ONCE);
        }
        
        // this.hitHand = hand;

        // saberControls.maxAnglePlaneX = 0;
        // saberControls.maxAnglePlaneY = 0;
        // saberControls.maxAnglePlaneXY = 0;

        // if (this.data.type === 'arrow') {
        //   saberControls.updateStrokeDirection();

        //   if (cutDirection === 'up' || cutDirection === 'down') {
        //     maxAngle = saberControls.maxAnglePlaneX;
        //   } else if (cutDirection === 'left' || cutDirection === 'right') {
        //   maxAngle = saberControls.maxAnglePlaneY;
        //   } else {
        //     maxAngle = saberControls.maxAnglePlaneXY;
        //   }
        // } else {
        //   maxAngle = Math.max(saberControls.maxAnglePlaneX, saberControls.maxAnglePlaneY,
        //                       saberControls.maxAnglePlaneXY);
        // }
        // this.angleBeforeHit = maxAngle;
        break;
      }
    }
  },

  onEndStroke: function () {
    // var cutDirection = this.data.cutDirection;
    // var hitEventDetail = this.hitEventDetail;
    // var maxAngle;
    // var saberControls = this.hitSaberEl.components['saber-controls'];
    // var scoreText;

    // // Harcoded temporarily.
    // const saberRotation = 3.14 / 12;

    // if (cutDirection === 'up' || cutDirection === 'down') {
    //   maxAngle = saberControls.maxAnglePlaneX;
    // } else if (cutDirection === 'left' || cutDirection === 'right') {
    //   maxAngle = saberControls.maxAnglePlaneY;
    // } else {
    //   maxAngle = saberControls.maxAnglePlaneXY;
    // }

    // const angleBeforeHit = Math.max(0, (this.angleBeforeHit - saberRotation) * 180 / Math.PI);
    // const angleAfterHit = Math.max(0, (maxAngle - saberRotation) * 180 / Math.PI);

    // let score = 0;
    // score += angleBeforeHit >= 85 ? 70 : (angleBeforeHit / 80) * 70;
    // score += angleAfterHit >= 60 ? 30 : (angleAfterHit / 60) * 30;

    // hitEventDetail.score = score;
    this.el.sceneEl.emit('textglowbold', null, false);

    // let beatScorePool;
    // if (score < 60) { beatScorePool = SCORE_POOL.OK; }
    // else if (score < 80) { beatScorePool = SCORE_POOL.GOOD; }
    // else if (score < 100) { beatScorePool = SCORE_POOL.GREAT; }
    // else {
    //   beatScorePool = SCORE_POOL.SUPER;

      // this.superCuts[this.superCutIdx].components.supercutfx.createSuperCut(this.el.object3D.position);
      // this.superCutIdx = (this.superCutIdx + 1) % this.superCuts.length;
    // }

    this.showScore();
    if (this.settings.settings.reducedDebris) {
      this.returnToPool(true);
    }
  },

  showScore: function (hand) {
    let score = this.replayNote.score;
    if (score < 0) {
      if (score == -3) {
        var missEl = hand === 'left' ? this.missElLeft : this.missElRight;
        if (!missEl) { return; }
        missEl.object3D.position.copy(this.el.object3D.position);
        missEl.object3D.position.y += 0.2;
        missEl.object3D.position.z -= 0.5;
        missEl.object3D.visible = true;
        missEl.emit('beatmiss', null, true);
      } else if (score == -2) {
        var wrongEl = hand === 'left' ? this.wrongElLeft : this.wrongElRight;
        if (!wrongEl) { return; }
        wrongEl.object3D.position.copy(this.el.object3D.position);
        wrongEl.object3D.position.y += 0.2;
        wrongEl.object3D.position.z -= 0.5;
        wrongEl.object3D.visible = true;
        wrongEl.emit('beatwrong', null, true);
      }
      
    } else {
      const scoreEl = this.el.sceneEl.components["pool__beatscoreok"].requestEntity();
      scoreEl.setAttribute('text', 'value', "" + score);

      let duration = 500 / this.song.speed;
      scoreEl.setAttribute('animation__opacityin', 'dur', duration);
      scoreEl.setAttribute('animation__opacityout', 'dur', duration);
      scoreEl.setAttribute('animation__motionz', 'dur', duration);
      scoreEl.setAttribute('animation__motiony', 'dur', duration);

      let random = Math.random() / 4;
      scoreEl.setAttribute('animation__motionz', 'to', -6 - random);
      scoreEl.setAttribute('animation__motiony', 'to', 0.3 + random);
      if (scoreEl) {
        scoreEl.object3D.position.copy(this.el.object3D.position);
        scoreEl.object3D.position.x += 0.6; // One block right
        scoreEl.object3D.position.z -= 3;
        scoreEl.play();
        scoreEl.emit('beatscorestart', null, false);

        // if (score == 115 && !this.settings.settings.noEffects) {
        //   this.superCuts[this.superCutIdx].components.supercutfx.createSuperCut(this.el.object3D.position);
        //   this.superCutIdx = (this.superCutIdx + 1) % this.superCuts.length;
        // }
      }
    }
  },

  tockDestroyed: (function () {
    var leftCutNormal = new THREE.Vector3();
    var leftRotation = 0;
    var rightCutNormal = new THREE.Vector3();
    var rightRotation = 0;
    var rotationStep = 2 * Math.PI / 150;
    var fragment;

    return function (timeDelta) {
      // Update gravity velocity.
      this.gravityVelocity = getGravityVelocity(this.gravityVelocity, timeDelta);
      this.el.object3D.position.y += this.gravityVelocity * (timeDelta / 1000) * this.song.speed;

      if (this.data.type == 'mine') {
        for (var i = 0; i < this.mineFragments.length; i++) {
          fragment = this.mineFragments[i];
          if (!fragment.visible) { continue; }
          fragment.position.addScaledVector(fragment.speed, (timeDelta / 1000) * this.song.speed);
          if (this.song.speed > 0) {
            fragment.scale.multiplyScalar(0.97 / this.song.speed)
          }
          
          if (fragment.scale.y < 0.1){
            fragment.visible = false;
          }
        }
        return;
      }

      rightCutNormal.copy(this.rightCutPlane.normal)
                    .multiplyScalar(DESTROYED_SPEED * (timeDelta / 500) * this.song.speed);
      rightCutNormal.y = 0;  // Y handled by gravity.
      this.partRightEl.object3D.position.add(rightCutNormal);
      this.partRightEl.object3D.setRotationFromAxisAngle(this.rotationAxis, rightRotation);
      rightRotation = rightRotation >= 2 * Math.PI ? 0 : rightRotation + rotationStep * this.song.speed;

      leftCutNormal.copy(this.leftCutPlane.normal)
                   .multiplyScalar(DESTROYED_SPEED * (timeDelta / 500) * this.song.speed);
      leftCutNormal.y = 0;  // Y handled by gravity.
      this.partLeftEl.object3D.position.add(leftCutNormal);
      this.partLeftEl.object3D.setRotationFromAxisAngle(this.rotationAxis, leftRotation);
      leftRotation = leftRotation >= 2 * Math.PI ? 0 : leftRotation + rotationStep * this.song.speed;

      this.generateCutClippingPlanes();

      this.returnToPoolTimer -= timeDelta * this.song.speed;
      this.backToPool = this.returnToPoolTimer <= 0;
    };
  })(),

  /**
   * Load OBJ from already parsed and loaded OBJ template.
   */
  setObjModelFromTemplate: (function () {
    const geometries = {};

    return function (el, templateId, material) {
      if (!geometries[templateId]) {
        const templateEl = document.getElementById(templateId);
        if (templateEl.getObject3D('mesh')) {
          geometries[templateId] = templateEl.getObject3D('mesh').children[0].geometry;
        } else {
          templateEl.addEventListener('model-loaded', () => {
            geometries[templateId] = templateEl.getObject3D('mesh').children[0].geometry;
            this.setObjModelFromTemplate(el, templateId);
          });
          return;
        }
      }

      if (!el.getObject3D('mesh')) { el.setObject3D('mesh', new THREE.Mesh()); }
      el.getObject3D('mesh').geometry = geometries[templateId];
      if (material) {
        el.getObject3D('mesh').material = material;
      }
    };
  })()
});

/**
 * Get velocity given current velocity using gravity acceleration.
 */
function getGravityVelocity (velocity, timeDelta) {
  const GRAVITY = -9.8;
  return velocity + (GRAVITY * (timeDelta / 1000));
}
