import * as THREE from 'three';

export class COMVisualizer {
  constructor(scene) {
    this.scene = scene;
    this.comMarker = null;
    this.comLine = null;
    this.comProjection = null;
    this.footprintLine = null; // 地面投影包络线
    this.createVisualization();
  }

  createVisualization() {
    // 创建重心标记（球体）
    const sphereGeometry = new THREE.SphereGeometry(0.03, 16, 16);
    const sphereMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff0000,
      transparent: true,
      opacity: 0.8
    });
    this.comMarker = new THREE.Mesh(sphereGeometry, sphereMaterial);
    this.scene.add(this.comMarker);

    // 创建投影到地面的连线
    const lineMaterial = new THREE.LineBasicMaterial({ 
      color: 0xff0000,
      transparent: true,
      opacity: 0.6,
      linewidth: 2
    });
    const lineGeometry = new THREE.BufferGeometry();
    this.comLine = new THREE.Line(lineGeometry, lineMaterial);
    this.scene.add(this.comLine);

    // 创建地面投影标记（圆形平面）
    const circleGeometry = new THREE.CircleGeometry(0.04, 32);
    const circleMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff0000,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5
    });
    this.comProjection = new THREE.Mesh(circleGeometry, circleMaterial);
    // CircleGeometry默认法线朝向+Z轴，直接放置在xOy平面
    this.scene.add(this.comProjection);

    // 创建地面投影包络线
    const footprintMaterial = new THREE.LineBasicMaterial({ 
      color: 0x00ff00,
      transparent: true,
      opacity: 0.8,
      linewidth: 3
    });
    const footprintGeometry = new THREE.BufferGeometry();
    this.footprintLine = new THREE.LineLoop(footprintGeometry, footprintMaterial);
    this.scene.add(this.footprintLine);

    // 默认隐藏
    this.hide();
  }

  calculateCOM(robot) {
    if (!robot) {
      console.warn('🎯 COM计算: 机器人为空');
      return null;
    }

    let totalMass = 0;
    const comPosition = new THREE.Vector3(0, 0, 0);
    const worldPosition = new THREE.Vector3();
    let linkCount = 0;
    let massCount = 0;

    // 递归遍历所有link
    robot.traverse((child) => {
      linkCount++;
      
      // 尝试多种方式访问inertial信息
      let inertial = null;
      let mass = 0;
      
      // urdfNode是XML DOM元素，需要查询子元素
      if (child.urdfNode && child.urdfNode.children) {
        // 查找inertial子元素
        for (let i = 0; i < child.urdfNode.children.length; i++) {
          const childElem = child.urdfNode.children[i];
          if (childElem.tagName === 'inertial') {
            // 解析mass
            const massElem = childElem.querySelector('mass');
            if (massElem) {
              mass = parseFloat(massElem.getAttribute('value')) || 0;
            }
            
            // 解析origin
            const originElem = childElem.querySelector('origin');
            let origin = null;
            if (originElem) {
              const xyz = originElem.getAttribute('xyz');
              if (xyz) {
                const coords = xyz.split(/\s+/).map(v => parseFloat(v));
                origin = {
                  xyz: coords
                };
              }
            }
            
            inertial = { mass, origin };
            break;
          }
        }
      }
      
      if (mass > 0 && inertial) {
        massCount++;
        // 获取link的世界坐标
        child.getWorldPosition(worldPosition);
        
        // 考虑惯性坐标系的偏移
        if (inertial.origin && inertial.origin.xyz) {
          const offset = new THREE.Vector3(
            inertial.origin.xyz[0],
            inertial.origin.xyz[1],
            inertial.origin.xyz[2]
          );
          // 将偏移转换到世界坐标系
          const worldQuaternion = new THREE.Quaternion();
          child.getWorldQuaternion(worldQuaternion);
          offset.applyQuaternion(worldQuaternion);
          worldPosition.add(offset);
        }
        
        // 累加质量加权位置
        comPosition.addScaledVector(worldPosition, mass);
        totalMass += mass;
      }
    });

    if (totalMass > 0) {
      comPosition.divideScalar(totalMass);
      return comPosition;
    }

    // 如果没有质量信息，使用几何中心作为近似
    return this.calculateGeometricCenter(robot);
  }

  calculateGeometricCenter(robot) {
    const bbox = new THREE.Box3().setFromObject(robot);
    
    if (bbox.isEmpty()) {
      return null;
    }
    
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    
    return center;
  }

  calculateFootprint(robot) {
    const points2D = [];
    const worldPosition = new THREE.Vector3();
    
    // 遍历所有link，收集低于0.1m的mesh顶点
    robot.traverse((child) => {
      // 只处理Mesh对象
      if (child.isMesh && child.geometry) {
        // 获取link的世界位置
        child.getWorldPosition(worldPosition);
        
        // 检查是否低于0.1m
        if (worldPosition.z < 0.1) {
          const geometry = child.geometry;
          const positionAttribute = geometry.attributes.position;
          
          if (positionAttribute) {
            // 遍历所有顶点
            const vertex = new THREE.Vector3();
            for (let i = 0; i < positionAttribute.count; i++) {
              vertex.fromBufferAttribute(positionAttribute, i);
              // 转换到世界坐标
              vertex.applyMatrix4(child.matrixWorld);
              
              // 投影到地面（z=0）
              points2D.push({ x: vertex.x, y: vertex.y });
            }
          }
        }
      }
    });
    
    if (points2D.length === 0) {
      return null;
    }
    
    // 计算2D凸包
    const hull = this.convexHull2D(points2D);
    
    return hull;
  }

  convexHull2D(points) {
    if (points.length < 3) return points;
    
    // Graham扫描算法计算凸包
    // 1. 找到最下方的点（y最小，若相同则x最小）
    let bottom = points[0];
    let bottomIndex = 0;
    for (let i = 1; i < points.length; i++) {
      if (points[i].y < bottom.y || (points[i].y === bottom.y && points[i].x < bottom.x)) {
        bottom = points[i];
        bottomIndex = i;
      }
    }
    
    // 2. 按极角排序
    const sorted = points.filter((_, i) => i !== bottomIndex);
    sorted.sort((a, b) => {
      const angleA = Math.atan2(a.y - bottom.y, a.x - bottom.x);
      const angleB = Math.atan2(b.y - bottom.y, b.x - bottom.x);
      if (angleA !== angleB) return angleA - angleB;
      // 如果角度相同，选择距离更远的点
      const distA = (a.x - bottom.x) ** 2 + (a.y - bottom.y) ** 2;
      const distB = (b.x - bottom.x) ** 2 + (b.y - bottom.y) ** 2;
      return distA - distB;
    });
    
    // 3. Graham扫描
    const hull = [bottom];
    
    const ccw = (p1, p2, p3) => {
      return (p2.x - p1.x) * (p3.y - p1.y) - (p2.y - p1.y) * (p3.x - p1.x);
    };
    
    for (const point of sorted) {
      while (hull.length >= 2 && ccw(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) {
        hull.pop();
      }
      hull.push(point);
    }
    
    return hull;
  }

  update(robot) {
    const com = this.calculateCOM(robot);
    
    if (com) {
      // 更新重心标记位置
      this.comMarker.position.copy(com);

      // 更新投影位置（z=0）
      this.comProjection.position.set(com.x, com.y, 0);

      // 更新连线
      const positions = new Float32Array([
        com.x, com.y, com.z,
        com.x, com.y, 0
      ]);
      this.comLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.comLine.geometry.computeBoundingSphere();

      this.show();
    } else {
      this.hide();
    }
  }
  
  updateFootprint(robot) {
    const footprint = this.calculateFootprint(robot);
    if (footprint && footprint.length > 0) {
      const positions = new Float32Array(footprint.length * 3);
      for (let i = 0; i < footprint.length; i++) {
        positions[i * 3] = footprint[i].x;
        positions[i * 3 + 1] = footprint[i].y;
        positions[i * 3 + 2] = 0.001; // 略微抬高避免z-fighting
      }
      this.footprintLine.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.footprintLine.geometry.computeBoundingSphere();
      this.footprintLine.visible = true;
    } else {
      this.footprintLine.visible = false;
    }
  }

  show() {
    this.comMarker.visible = true;
    this.comLine.visible = true;
    this.comProjection.visible = true;
    // footprintLine的显示状态由update方法控制
  }

  hide() {
    this.comMarker.visible = false;
    this.comLine.visible = false;
    this.comProjection.visible = false;
    this.footprintLine.visible = false;
  }

  setVisible(visible) {
    if (visible) {
      this.show();
    } else {
      this.hide();
    }
  }

  dispose() {
    this.scene.remove(this.comMarker);
    this.scene.remove(this.comLine);
    this.scene.remove(this.comProjection);
    this.scene.remove(this.footprintLine);
    
    this.comMarker.geometry.dispose();
    this.comMarker.material.dispose();
    this.comLine.geometry.dispose();
    this.comLine.material.dispose();
    this.comProjection.geometry.dispose();
    this.comProjection.material.dispose();
    this.footprintLine.geometry.dispose();
    this.footprintLine.material.dispose();
  }
}
