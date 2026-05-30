import * as THREE from 'three';

export class COMVisualizer {
  constructor(scene) {
    this.scene = scene;
    this.comMarker = null;
    this.comLine = null;
    this.comProjection = null;
    this.footprintLine = null; // 地面投影包络线
    this.footprintCenter = null; // 包络线几何中心标记
    this.footprintAxis1 = null; // 主轴1（最大方差方向）
    this.footprintAxis2 = null; // 主轴2（最小方差方向）
    
    // 缓存最新的包络线数据和PCA结果
    this.cachedFootprint = null;
    this.cachedCentroid = null;
    this.cachedPCA = null;
    this.cachedCOM = null;
    
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

    // 创建包络线几何中心标记（小球）
    const centerGeometry = new THREE.SphereGeometry(0.02, 16, 16);
    const centerMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xffff00,
      transparent: true,
      opacity: 0.9
    });
    this.footprintCenter = new THREE.Mesh(centerGeometry, centerMaterial);
    this.scene.add(this.footprintCenter);

    // 创建主轴1（最大方差方向，红色）
    const axis1Material = new THREE.LineBasicMaterial({ 
      color: 0xff3333,
      transparent: true,
      opacity: 0.8,
      linewidth: 3
    });
    const axis1Geometry = new THREE.BufferGeometry();
    this.footprintAxis1 = new THREE.Line(axis1Geometry, axis1Material);
    this.scene.add(this.footprintAxis1);

    // 创建主轴2（最小方差方向，绿色）
    const axis2Material = new THREE.LineBasicMaterial({ 
      color: 0x33ff33,
      transparent: true,
      opacity: 0.8,
      linewidth: 3
    });
    const axis2Geometry = new THREE.BufferGeometry();
    this.footprintAxis2 = new THREE.Line(axis2Geometry, axis2Material);
    this.scene.add(this.footprintAxis2);

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
    const linkDetails = []; // 用于调试

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
      
      // 记录调试信息（仅对有名称的link）
      if (child.name || child.urdfName) {
        linkDetails.push({
          name: child.name || 'unnamed',
          urdfName: child.urdfName || 'unknown',
          hasUrdfNode: !!child.urdfNode,
          hasInertial: !!inertial,
          mass: mass
        });
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

    // 打印调试信息
    console.log(`🎯 COM计算统计:`);
    console.log(`  - 总link数: ${linkCount}`);
    console.log(`  - 有质量的link数: ${massCount}`);
    console.log(`  - 总质量: ${totalMass.toFixed(3)}kg`);
    if (massCount === 0) {
      console.warn(`  ⚠️ 未找到质量信息，将使用几何中心作为近似`);
    }
    if (linkDetails.length > 0 && linkDetails.length < 50) {
      console.table(linkDetails);
    }

    if (totalMass > 0) {
      comPosition.divideScalar(totalMass);
      console.log(`  - 计算的COM位置: (${comPosition.x.toFixed(3)}, ${comPosition.y.toFixed(3)}, ${comPosition.z.toFixed(3)})`);
      return comPosition;
    }

    // 如果没有质量信息，使用几何中心作为近似
    console.log(`  - 使用几何中心作为COM近似`);
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

  calculateFootprint(robot, heightThresholdMeters = 0.1) {
    const points2D = [];
    const worldPosition = new THREE.Vector3();
    
    // 遍历所有link，收集低于阈值的mesh顶点
    robot.traverse((child) => {
      // 只处理Mesh对象
      if (child.isMesh && child.geometry) {
        // 获取link的世界位置
        child.getWorldPosition(worldPosition);
        
        // 检查是否低于高度阈值
        if (worldPosition.z < heightThresholdMeters) {
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
    
    // 简化点集：如果点太多，进行抽稀
    let simplifiedPoints = points2D;
    if (points2D.length > 500) {
      // 使用网格化简化：将空间分为网格，每个网格只保留一个点
      const gridSize = 0.05; // 5cm网格
      const gridMap = new Map();
      
      for (const point of points2D) {
        const gridX = Math.floor(point.x / gridSize);
        const gridY = Math.floor(point.y / gridSize);
        const key = `${gridX},${gridY}`;
        
        if (!gridMap.has(key)) {
          gridMap.set(key, point);
        }
      }
      
      simplifiedPoints = Array.from(gridMap.values());
      console.log(`📏 点简化: ${points2D.length} -> ${simplifiedPoints.length}`);
    }
    
    // 计算2D凸包
    const hull = this.convexHull2D(simplifiedPoints);
    
    return hull;
  }

  /**
   * 计算多边形的解析中心（质心）
   * 使用面积加权的质心公式
   */
  calculatePolygonCentroid(points) {
    if (!points || points.length === 0) {
      return { x: 0, y: 0 };
    }
    
    if (points.length === 1) {
      return { x: points[0].x, y: points[0].y };
    }
    
    if (points.length === 2) {
      return {
        x: (points[0].x + points[1].x) / 2,
        y: (points[0].y + points[1].y) / 2
      };
    }
    
    // 对于多边形，使用质心公式
    let area = 0;
    let cx = 0;
    let cy = 0;
    
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      const xi = points[i].x;
      const yi = points[i].y;
      const xj = points[j].x;
      const yj = points[j].y;
      
      const cross = xi * yj - xj * yi;
      area += cross;
      cx += (xi + xj) * cross;
      cy += (yi + yj) * cross;
    }
    
    area *= 0.5;
    
    // 防止面积为0的情况（共线点）
    if (Math.abs(area) < 1e-10) {
      // 退化为几何中心
      let sumX = 0, sumY = 0;
      for (const point of points) {
        sumX += point.x;
        sumY += point.y;
      }
      return {
        x: sumX / points.length,
        y: sumY / points.length
      };
    }
    
    cx /= (6 * area);
    cy /= (6 * area);
    
    return { x: cx, y: cy };
  }

  /**
   * 计算主成分分析（PCA）- 找到最大和最小方差方向
   */
  calculatePCA(points, center) {
    if (!points || points.length < 2) {
      return null;
    }

    // 计算协方差矩阵
    let cov_xx = 0, cov_xy = 0, cov_yy = 0;
    
    for (const point of points) {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      cov_xx += dx * dx;
      cov_xy += dx * dy;
      cov_yy += dy * dy;
    }
    
    const n = points.length;
    cov_xx /= n;
    cov_xy /= n;
    cov_yy /= n;

    // 计算特征值和特征向量
    // 协方差矩阵: [cov_xx, cov_xy]
    //             [cov_xy, cov_yy]
    
    // 特征值通过求解 det(C - λI) = 0
    const trace = cov_xx + cov_yy;
    const det = cov_xx * cov_yy - cov_xy * cov_xy;
    
    const lambda1 = trace / 2 + Math.sqrt((trace * trace) / 4 - det);
    const lambda2 = trace / 2 - Math.sqrt((trace * trace) / 4 - det);

    // 计算对应的特征向量
    // 对于 lambda1 (最大特征值)
    let v1x, v1y;
    if (Math.abs(cov_xy) > 1e-10) {
      v1x = lambda1 - cov_yy;
      v1y = cov_xy;
    } else {
      // 如果 cov_xy ≈ 0，协方差矩阵是对角的
      v1x = 1;
      v1y = 0;
    }
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    v1x /= len1;
    v1y /= len1;

    // 对于 lambda2 (最小特征值)，向量垂直于第一个
    const v2x = -v1y;
    const v2y = v1x;

    return {
      eigenvalues: [lambda1, lambda2],
      eigenvectors: [
        { x: v1x, y: v1y }, // 最大方差方向
        { x: v2x, y: v2y }  // 最小方差方向
      ]
    };
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

      // 缓存COM位置
      this.cachedCOM = com.clone();

      this.show();
    } else {
      this.hide();
    }
  }
  
  updateFootprint(robot, heightThresholdMeters = 0.1) {
    const footprint = this.calculateFootprint(robot, heightThresholdMeters);
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

      // 计算解析中心（质心）
      const center = this.calculatePolygonCentroid(footprint);
      
      // 更新几何中心标记
      this.footprintCenter.position.set(center.x, center.y, 0.002);
      this.footprintCenter.visible = true;

      // 计算主轴（PCA）
      const pca = this.calculatePCA(footprint, center);
      
      // 更新主轴1（最大方差方向）
      if (pca) {
        let axis1Length = Math.sqrt(pca.eigenvalues[0]) * 2; // 使用标准差的2倍作为长度
        const axis2Length = Math.sqrt(pca.eigenvalues[1]) * 2;

        // 检查长短轴比例，如果不满足1.5倍则延长主轴
        if (axis2Length > 0 && axis1Length / axis2Length < 1.5) {
          axis1Length = axis2Length * 1.5;
        }

        const axis1Start = {
          x: center.x - pca.eigenvectors[0].x * axis1Length,
          y: center.y - pca.eigenvectors[0].y * axis1Length
        };
        const axis1End = {
          x: center.x + pca.eigenvectors[0].x * axis1Length,
          y: center.y + pca.eigenvectors[0].y * axis1Length
        };
        const axis1Positions = new Float32Array([
          axis1Start.x, axis1Start.y, 0.002,
          axis1End.x, axis1End.y, 0.002
        ]);
        this.footprintAxis1.geometry.setAttribute('position', new THREE.BufferAttribute(axis1Positions, 3));
        this.footprintAxis1.geometry.computeBoundingSphere();
        this.footprintAxis1.visible = true;

        // 更新主轴2（最小方差方向）
        // axis2Length 已经在上面计算过了
        const axis2Start = {
          x: center.x - pca.eigenvectors[1].x * axis2Length,
          y: center.y - pca.eigenvectors[1].y * axis2Length
        };
        const axis2End = {
          x: center.x + pca.eigenvectors[1].x * axis2Length,
          y: center.y + pca.eigenvectors[1].y * axis2Length
        };
        const axis2Positions = new Float32Array([
          axis2Start.x, axis2Start.y, 0.002,
          axis2End.x, axis2End.y, 0.002
        ]);
        this.footprintAxis2.geometry.setAttribute('position', new THREE.BufferAttribute(axis2Positions, 3));
        this.footprintAxis2.geometry.computeBoundingSphere();
        this.footprintAxis2.visible = true;

        console.log('📊 PCA分析（解析中心）:', {
          centroid: center,
          eigenvalues: pca.eigenvalues,
          eigenvectors: pca.eigenvectors
        });
        
        // 缓存数据供自动旋转功能使用
        this.cachedFootprint = footprint;
        this.cachedCentroid = center;
        this.cachedPCA = pca;
      }
    } else {
      this.footprintLine.visible = false;
      this.footprintCenter.visible = false;
      this.footprintAxis1.visible = false;
      this.footprintAxis2.visible = false;
      
      // 清除缓存
      this.cachedFootprint = null;
      this.cachedCentroid = null;
      this.cachedPCA = null;
    }
  }

  /**
   * 获取缓存的包络线分析数据
   */
  getFootprintData() {
    return {
      footprint: this.cachedFootprint,
      centroid: this.cachedCentroid,
      pca: this.cachedPCA,
      com: this.cachedCOM
    };
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
    this.footprintCenter.visible = false;
    this.footprintAxis1.visible = false;
    this.footprintAxis2.visible = false;
  }

  setVisible(visible) {
    if (visible) {
      this.show();
    } else {
      this.hide();
    }
  }

  /** 切换附着场景（overlay / split 视口切换时） */
  setScene(newScene) {
    if (!newScene || newScene === this.scene) return;
    const objs = [
      this.comMarker,
      this.comLine,
      this.comProjection,
      this.footprintLine,
      this.footprintCenter,
      this.footprintAxis1,
      this.footprintAxis2
    ].filter(Boolean);
    for (const obj of objs) {
      this.scene.remove(obj);
      newScene.add(obj);
    }
    this.scene = newScene;
  }

  dispose() {
    this.scene.remove(this.comMarker);
    this.scene.remove(this.comLine);
    this.scene.remove(this.comProjection);
    this.scene.remove(this.footprintLine);
    this.scene.remove(this.footprintCenter);
    this.scene.remove(this.footprintAxis1);
    this.scene.remove(this.footprintAxis2);
    
    this.comMarker.geometry.dispose();
    this.comMarker.material.dispose();
    this.comLine.geometry.dispose();
    this.comLine.material.dispose();
    this.comProjection.geometry.dispose();
    this.comProjection.material.dispose();
    this.footprintLine.geometry.dispose();
    this.footprintLine.material.dispose();
    this.footprintCenter.geometry.dispose();
    this.footprintCenter.material.dispose();
    this.footprintAxis1.geometry.dispose();
    this.footprintAxis1.material.dispose();
    this.footprintAxis2.geometry.dispose();
    this.footprintAxis2.material.dispose();
  }
}
