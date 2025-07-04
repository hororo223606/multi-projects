let scene, camera, renderer, viewer;
let pins = [];
let pinDisks = [[], [], []];
let selectedDisk = null;
let selectedFromPin = null;
let draggedDisk = null;
let isMouseDown = false;
let dragStartTime = 0;
const dragThreshold = 150; // ms

const diskHeights = 0.5;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();

initUI();
initThree();
generateTower(6);
animate();

function initUI() {
  const select = document.getElementById("diskCount");
  for (let i = 3; i <= 10; i++) {
    const option = document.createElement("option");
    option.value = i;
    option.textContent = i;
    select.appendChild(option);
  }
  select.value = 6;

  document.getElementById("resetButton").addEventListener("click", () => {
    const count = parseInt(select.value, 10);
    generateTower(count);
  });
}

function initThree() {
  viewer = document.getElementById("viewer");

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(viewer.clientWidth, viewer.clientHeight);
  viewer.appendChild(renderer.domElement);

  const aspect = viewer.clientWidth / viewer.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 1, 1000);
  camera.position.set(0, 10, 20);
  camera.lookAt(0, 2.5, 0);

  scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0x888888));
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(10, 20, 10);
  scene.add(light);

  viewer.addEventListener("click", onClick);
  viewer.addEventListener("mousedown", onMouseDown);
  viewer.addEventListener("mousemove", onMouseMove);
  viewer.addEventListener("mouseup", onMouseUp);
}

function generateTower(MAXDISK) {
  while (scene.children.length > 0) scene.remove(scene.children.pop());
  selectedDisk = null;
  selectedFromPin = null;
  draggedDisk = null;
  pinDisks = [[], [], []];
  pins = [];

  scene.add(new THREE.AmbientLight(0x888888));
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(10, 20, 10);
  scene.add(light);

  const pinHeight = diskHeights * MAXDISK + 1.0;

  for (let i = -1; i <= 1; i++) {
    const x = i * 5;
    const y = pinHeight / 2;

    const pin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, pinHeight),
      new THREE.MeshStandardMaterial({ color: 0x888888 })
    );
    pin.position.set(x, y, 0);
    scene.add(pin);

    const hitPin = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, pinHeight + 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.0 })
    );
    hitPin.position.set(x, y, 0);
    hitPin.userData.index = i + 1;
    scene.add(hitPin);
    pins[i + 1] = hitPin;
  }

  for (let i = 0; i < MAXDISK; i++) {
    const radius = 2 - i / (MAXDISK - 1);
    const disk = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, diskHeights, 32),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(`hsl(${i * 60}, 100%, 50%)`) })
    );
    disk.position.set(pins[0].position.x, diskHeights / 2 + i * diskHeights, 0);
    disk.userData.size = MAXDISK - i;
    scene.add(disk);
    pinDisks[0].push(disk);
  }
}

function onClick(event) {
  if (Date.now() - dragStartTime > dragThreshold || draggedDisk) return;

  const rect = viewer.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObjects([...pins, ...pinDisks.flat()]);
  if (intersects.length === 0) return;

  const obj = intersects[0].object;

  if (obj.userData.size !== undefined) {
    if (selectedDisk === obj) {
      selectedDisk.material.emissive.set(0x000000);
      selectedDisk = null;
      selectedFromPin = null;
      return;
    }
    for (let i = 0; i < 3; i++) {
      const stack = pinDisks[i];
      if (stack.length > 0 && stack[stack.length - 1] === obj) {
        if (selectedDisk) selectedDisk.material.emissive.set(0x000000);
        selectedDisk = obj;
        selectedFromPin = i;
        selectedDisk.material.emissive = new THREE.Color(0x3333ff);
        return;
      }
    }
    return;
  }

  const pinIndex = obj.userData.index;
  const stack = pinDisks[pinIndex];

  if (!selectedDisk) {
    if (stack.length > 0) {
      selectedDisk = stack[stack.length - 1];
      selectedFromPin = pinIndex;
      selectedDisk.material.emissive = new THREE.Color(0x3333ff);
    }
  } else {
    const targetStack = pinDisks[pinIndex];
    const top = targetStack[targetStack.length - 1];
    if (!top || top.userData.size > selectedDisk.userData.size) {
      pinDisks[selectedFromPin].pop();
      targetStack.push(selectedDisk);
      const newY = diskHeights / 2 + (targetStack.length - 1) * diskHeights;
      selectedDisk.position.set(pins[pinIndex].position.x, newY, 0);
    }
    selectedDisk.material.emissive.set(0x000000);
    selectedDisk = null;
    selectedFromPin = null;
  }
}

let dragCandidate = null; // 👈 一時的に保持する候補

function onMouseDown(event) {
  isMouseDown = true;
  dragStartTime = Date.now();
  dragCandidate = null;

  const rect = viewer.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(pinDisks.flat());
  if (intersects.length > 0) {
    const obj = intersects[0].object;
    for (let i = 0; i < 3; i++) {
      const stack = pinDisks[i];
      if (stack.length > 0 && stack[stack.length - 1] === obj) {
        dragCandidate = { obj, fromPin: i }; // 👈 すぐにdraggedDiskにしない
        break;
      }
    }
  }
}



function onMouseMove(event) {
  if (!isMouseDown) return;

  const now = Date.now();
  if (dragCandidate && !draggedDisk && now - dragStartTime > dragThreshold) {
    // threshold超えたのでドラッグ開始
    draggedDisk = dragCandidate.obj;
    selectedFromPin = dragCandidate.fromPin;

    // もし選択中があれば解除
    if (selectedDisk) {
      selectedDisk.material.emissive.set(0x000000);
      selectedDisk = null;
    }
  }

  if (!draggedDisk) return;

  const rect = viewer.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);

  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // Z=0 平面
  const intersection = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, intersection);

  const minY = 0.5;
  const maxY = 10;
  const clampedY = Math.max(minY, Math.min(maxY, intersection.y));

  draggedDisk.position.set(intersection.x, clampedY, 0);
}


function onMouseUp(event) {
  isMouseDown = false;

  if (draggedDisk && Date.now() - dragStartTime > dragThreshold) {
    // ドロップ対象ピンを x 位置から最も近いもので決定
    const diskX = draggedDisk.position.x;
    let closestIndex = 0;
    let minDist = Infinity;
    for (let i = 0; i < 3; i++) {
      const dx = pins[i].position.x - diskX;
      if (Math.abs(dx) < minDist) {
        minDist = Math.abs(dx);
        closestIndex = i;
      }
    }

    const targetStack = pinDisks[closestIndex];
    const top = targetStack[targetStack.length - 1];

    // 置ける条件：空 or 一番上より小さい
    if (!top || top.userData.size > draggedDisk.userData.size) {
      pinDisks[selectedFromPin].pop(); // 元の場所から外す
      targetStack.push(draggedDisk);  // 新しい場所に追加

      // 正しいY位置に整列
      const newY = diskHeights / 2 + (targetStack.length - 1) * diskHeights;
      draggedDisk.position.set(pins[closestIndex].position.x, newY, 0);
    } else {
      // 不正な置き方 → 元の位置に戻す
      const stack = pinDisks[selectedFromPin];
      const resetY = diskHeights / 2 + (stack.length - 1) * diskHeights;
      draggedDisk.position.set(pins[selectedFromPin].position.x, resetY, 0);
    }

    draggedDisk = null;
    selectedFromPin = null;
    dragCandidate = null;
  }
}


function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}
