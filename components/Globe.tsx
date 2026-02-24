'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import gsap from 'gsap';
import * as d3 from 'd3-geo';
import * as topojson from 'topojson-client';
import { Compass, Cloud, Wind, Thermometer, Sparkles } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';

const svgViewBox = [2000, 1000];
const offsetY = -0.1;

export default function Globe() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [countryName, setCountryName] = useState('');
  const [clickedCountry, setClickedCountry] = useState<{ name: string; id?: string } | null>(null);
  const [svgPaths, setSvgPaths] = useState<{ d: string; name: string; id: string }[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [deviceMotionSupported, setDeviceMotionSupported] = useState(false);
  const [isDeviceMotionActive, setIsDeviceMotionActive] = useState(false);
  const [weatherData, setWeatherData] = useState<{
    temperature: number;
    windspeed: number;
    weathercode: number;
    capital: string;
  } | null>(null);
  const [countryDetails, setCountryDetails] = useState<{
    population: number;
    region: string;
    subregion: string;
    currencies: string;
    languages: string;
    capital: string;
  } | null>(null);
  const [isLoadingWeather, setIsLoadingWeather] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [isLoadingSummary, setIsLoadingSummary] = useState(false);
  const [groundingSources, setGroundingSources] = useState<{ uri: string; title: string }[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<string>('Global');

  const regions = [
    { name: 'Global', rotX: 0, rotY: 0 },
    { name: 'North America', rotX: 0.5, rotY: -1.5 },
    { name: 'South America', rotX: -0.3, rotY: -1.0 },
    { name: 'Europe', rotX: 0.8, rotY: 0.2 },
    { name: 'Africa', rotX: 0.1, rotY: 0.3 },
    { name: 'Asia', rotX: 0.5, rotY: 1.5 },
    { name: 'Oceania', rotX: -0.4, rotY: 2.5 },
  ];

  function getWeatherDescription(code: number) {
    if (code === 0) return 'Clear sky';
    if (code === 1 || code === 2 || code === 3) return 'Mainly clear, partly cloudy, and overcast';
    if (code === 45 || code === 48) return 'Fog and depositing rime fog';
    if (code >= 51 && code <= 55) return 'Drizzle';
    if (code >= 61 && code <= 65) return 'Rain';
    if (code >= 71 && code <= 75) return 'Snow fall';
    if (code >= 80 && code <= 82) return 'Rain showers';
    if (code >= 85 && code <= 86) return 'Snow showers';
    if (code >= 95) return 'Thunderstorm';
    return 'Unknown';
  }

  useEffect(() => {
    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      setDeviceMotionSupported(true);
    }
    
    fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json')
      .then((res) => res.json())
      .then((topology) => {
        const geojson = topojson.feature(topology, topology.objects.countries);
        const projection = d3.geoEquirectangular().fitSize([svgViewBox[0], svgViewBox[1]], geojson as any);
        const pathGenerator = d3.geoPath().projection(projection);

        const paths = (geojson as any).features.map((feature: any) => ({
          d: pathGenerator(feature) || '',
          name: feature.properties.name,
          id: feature.id,
        }));
        setSvgPaths(paths);
        setIsLoaded(true);
      });
  }, []);

  const requestDeviceOrientation = async () => {
    if (isDeviceMotionActive) {
      setIsDeviceMotionActive(false);
      return;
    }

    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      try {
        const permissionState = await (DeviceOrientationEvent as any).requestPermission();
        if (permissionState === 'granted') {
          setIsDeviceMotionActive(true);
        }
      } catch (error) {
        console.error(error);
      }
    } else {
      setIsDeviceMotionActive(true);
    }
  };

  useEffect(() => {
    if (!clickedCountry) {
      setWeatherData(null);
      setCountryDetails(null);
      setAiSummary(null);
      setGroundingSources([]);
      return;
    }

    let isMounted = true;
    setIsLoadingWeather(true);
    setIsLoadingSummary(true);
    setWeatherData(null);
    setCountryDetails(null);
    setAiSummary(null);
    setGroundingSources([]);

    async function fetchSummary(countryName: string) {
      try {
        const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) {
          if (isMounted) {
            setAiSummary("Gemini API key not configured.");
            setIsLoadingSummary(false);
          }
          return;
        }

        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `Provide a brief, 2-sentence interesting fact or recent news about ${countryName}.`,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        if (isMounted) {
          setAiSummary(response.text || 'No summary available.');
          const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
          if (chunks) {
            const sources = chunks.map((chunk: any) => chunk.web).filter(Boolean);
            // Deduplicate sources by URI
            const uniqueSources = Array.from(new Map(sources.map((s: any) => [s.uri, s])).values());
            setGroundingSources(uniqueSources as { uri: string; title: string }[]);
          }
          setIsLoadingSummary(false);
        }
      } catch (error) {
        console.error("Gemini API error:", error);
        if (isMounted) {
          setAiSummary('Failed to load summary.');
          setIsLoadingSummary(false);
        }
      }
    }

    async function fetchWeather() {
      try {
        let countryRes = await fetch(`https://restcountries.com/v3.1/name/${clickedCountry?.name}?fullText=true`);
        if (!countryRes.ok && clickedCountry?.id) {
            countryRes = await fetch(`https://restcountries.com/v3.1/alpha/${clickedCountry.id}`);
        }
        
        if (!countryRes.ok) {
            countryRes = await fetch(`https://restcountries.com/v3.1/name/${clickedCountry?.name}`);
        }

        if (!countryRes.ok) throw new Error('Country not found');
        
        const countryData = await countryRes.json();
        const country = countryData[0];
        
        let lat, lng, capital;
        if (country.capitalInfo && country.capitalInfo.latlng) {
            [lat, lng] = country.capitalInfo.latlng;
            capital = country.capital?.[0] || 'Capital';
        } else if (country.latlng) {
            [lat, lng] = country.latlng;
            capital = country.name.common;
        } else {
            throw new Error('No coordinates found');
        }

        const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`);
        if (!weatherRes.ok) throw new Error('Weather not found');
        
        const weatherData = await weatherRes.json();
        
        if (isMounted) {
            setCountryDetails({
                population: country.population,
                region: country.region,
                subregion: country.subregion,
                currencies: country.currencies ? Object.values(country.currencies).map((c: any) => c.name).join(', ') : 'N/A',
                languages: country.languages ? Object.values(country.languages).join(', ') : 'N/A',
                capital: capital
            });
            setWeatherData({
                temperature: weatherData.current_weather.temperature,
                windspeed: weatherData.current_weather.windspeed,
                weathercode: weatherData.current_weather.weathercode,
                capital: capital
            });
            setIsLoadingWeather(false);
        }
      } catch (error) {
        console.error(error);
        if (isMounted) {
            setIsLoadingWeather(false);
        }
      }
    }

    fetchWeather();
    fetchSummary(clickedCountry.name);

    return () => {
        isMounted = false;
    };
  }, [clickedCountry]);

  useEffect(() => {
    if (!isLoaded || !containerRef.current || !canvasRef.current) return;

    const containerEl = containerRef.current;
    const canvasEl = canvasRef.current;

    let renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.OrthographicCamera, rayCaster: THREE.Raycaster, pointer: THREE.Vector2, controls: OrbitControls | undefined;
    let globeGroup: THREE.Group, globeColorMesh: THREE.Mesh, globeStrokesMesh: THREE.Mesh, globeSelectionOuterMesh: THREE.Mesh, globeClickedMesh: THREE.Mesh, nightLightsMesh: THREE.Mesh;

    const params = {
      strokeColor: '#111111',
      defaultColor: '#9a9591',
      hoverColor: '#00C9A2',
      clickedColor: '#ff3366',
      fogColor: '#e4e5e6',
      fogDistance: 2.6,
      strokeWidth: 2,
      hiResScalingFactor: 8, // Increased from 4 for higher resolution
      lowResScalingFactor: 1.5,
      nightLights: false,
    };

    let hoveredCountryIdx = -1;
    let clickedCountryIdx = -1;
    let clickTimeout: NodeJS.Timeout | null = null;
    let isTouchScreen = false;
    let isHoverable = true;
    
    let targetRotationX = 0;
    let targetRotationY = 0;
    let targetZoom = 1;

    // Expose a function to rotate the globe to a specific region
    (window as any).rotateToRegion = (rotX: number, rotY: number) => {
      if (isDeviceMotionActive) return;
      
      if (controls) {
        controls.autoRotate = false;
      }
      
      gsap.to(globeGroup.rotation, {
        x: rotX,
        y: rotY,
        duration: 1.5,
        ease: 'power2.inOut',
        onComplete: () => {
          if (controls && !isDeviceMotionActive && clickedCountryIdx === -1) {
            controls.autoRotate = true;
          }
        }
      });
    };

    const textureLoader = new THREE.TextureLoader();
    let gui: GUI;

    const pickingCanvas = document.createElement('canvas');
    pickingCanvas.width = svgViewBox[0];
    pickingCanvas.height = svgViewBox[1];
    const pickingCtx = pickingCanvas.getContext('2d', { willReadFrequently: true });
    if (pickingCtx) {
      pickingCtx.translate(0, -offsetY * svgViewBox[1]);
      svgPaths.forEach((path, i) => {
        pickingCtx.fillStyle = `rgb(${(i + 1) >> 16 & 255}, ${(i + 1) >> 8 & 255}, ${(i + 1) & 255})`;
        pickingCtx.fill(new Path2D(path.d));
      });
    }

    const mapCanvas = document.createElement('canvas');
    const mapCtx = mapCanvas.getContext('2d');
    const mapTexture = new THREE.CanvasTexture(mapCanvas);
    mapTexture.colorSpace = THREE.SRGBColorSpace;

    const strokesCanvas = document.createElement('canvas');
    const strokesCtx = strokesCanvas.getContext('2d');
    const strokesTexture = new THREE.CanvasTexture(strokesCanvas);
    strokesTexture.colorSpace = THREE.SRGBColorSpace;

    const highlightCanvas = document.createElement('canvas');
    const highlightCtx = highlightCanvas.getContext('2d');
    const highlightTexture = new THREE.CanvasTexture(highlightCanvas);
    highlightTexture.colorSpace = THREE.SRGBColorSpace;

    const clickCanvas = document.createElement('canvas');
    const clickCtx = clickCanvas.getContext('2d');
    const clickTexture = new THREE.CanvasTexture(clickCanvas);
    clickTexture.colorSpace = THREE.SRGBColorSpace;

    function initScene() {
      renderer = new THREE.WebGLRenderer({ canvas: canvasEl, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      scene = new THREE.Scene();
      scene.fog = new THREE.Fog(params.fogColor, 0, params.fogDistance);

      const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
      scene.add(ambientLight);

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
      directionalLight.position.set(1, 1, 2);
      scene.add(directionalLight);

      camera = new THREE.OrthographicCamera(-1.2, 1.2, 1.2, -1.2, 0, 3);
      camera.position.z = 1.3;

      globeGroup = new THREE.Group();
      scene.add(globeGroup);

      rayCaster = new THREE.Raycaster();
      rayCaster.far = 1.15;
      pointer = new THREE.Vector2(-1, -1);

      createOrbitControls();
      createGlobe();
      
      (globeColorMesh.material as THREE.MeshStandardMaterial).map = mapTexture;
      (globeStrokesMesh.material as THREE.MeshBasicMaterial).map = strokesTexture;
      (globeSelectionOuterMesh.material as THREE.MeshBasicMaterial).map = highlightTexture;
      (globeClickedMesh.material as THREE.MeshBasicMaterial).map = clickTexture;

      prepareInitialTextures();

      // Lazy load high-res textures when globe becomes visible
      const observer = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          setTimeout(() => {
            prepareHiResTextures();
          }, 300); // Small delay to ensure smooth initial render
          observer.disconnect();
        }
      });
      observer.observe(containerEl);

      updateSize();

      gsap.ticker.add(render);
    }

    function createOrbitControls() {
      controls = new OrbitControls(camera, canvasEl);
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.minPolarAngle = 0.46 * Math.PI;
      controls.maxPolarAngle = 0.46 * Math.PI;
      controls.autoRotate = !isDeviceMotionActive;
      controls.autoRotateSpeed *= 0.5; // Slower default rotation

      controls.addEventListener('start', () => {
        isHoverable = false;
        pointer = new THREE.Vector2(-1, -1);
        gsap.to(globeGroup.scale, {
          duration: 0.3,
          x: 0.9,
          y: 0.9,
          z: 0.9,
          ease: 'power1.inOut',
        });
      });
      controls.addEventListener('end', () => {
        gsap.to(globeGroup.scale, {
          duration: 0.6,
          x: 1,
          y: 1,
          z: 1,
          ease: 'back(1.7).out',
          onComplete: () => {
            isHoverable = true;
          },
        });
      });
    }

    function createGlobe() {
      const globeGeometry = new THREE.IcosahedronGeometry(1, 40); // Increased geometry detail for better lighting

      const globeColorMaterial = new THREE.MeshStandardMaterial({
        transparent: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.1,
      });
      const globeStrokeMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        depthTest: false,
      });
      const outerSelectionColorMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.DoubleSide,
      });
      const clickedCountryMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.DoubleSide,
      });
      const nightLightsMaterial = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
      });

      // Load ambient occlusion map
      textureLoader.load('https://unpkg.com/three-globe/example/img/earth-water.png', (texture) => {
        // Using water map as a makeshift AO/specular map for better depth
        globeColorMaterial.aoMap = texture;
        globeColorMaterial.aoMapIntensity = 0.5;
        globeColorMaterial.needsUpdate = true;
      });

      globeColorMesh = new THREE.Mesh(globeGeometry, globeColorMaterial);
      globeStrokesMesh = new THREE.Mesh(globeGeometry, globeStrokeMaterial);
      globeSelectionOuterMesh = new THREE.Mesh(globeGeometry, outerSelectionColorMaterial);
      globeClickedMesh = new THREE.Mesh(globeGeometry, clickedCountryMaterial);
      nightLightsMesh = new THREE.Mesh(globeGeometry, nightLightsMaterial);
      globeClickedMesh.visible = false;

      // Load night lights texture
      textureLoader.load('https://unpkg.com/three-globe/example/img/earth-night.jpg', (texture) => {
        nightLightsMaterial.map = texture;
        nightLightsMaterial.needsUpdate = true;
      });

      globeStrokesMesh.renderOrder = 2;
      globeClickedMesh.renderOrder = 3;
      nightLightsMesh.renderOrder = 1;

      globeGroup.add(globeStrokesMesh, globeSelectionOuterMesh, globeClickedMesh, globeColorMesh, nightLightsMesh);
    }

    function drawMap(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D | null, scale: number, isStrokesOnly: boolean = false) {
      if (!ctx) return;
      canvas.width = svgViewBox[0] * scale;
      canvas.height = svgViewBox[1] * scale;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(scale, scale);
      ctx.translate(0, -offsetY * svgViewBox[1]);
      
      ctx.strokeStyle = params.strokeColor;
      ctx.lineWidth = params.strokeWidth;

      if (!isStrokesOnly) {
        ctx.fillStyle = params.defaultColor;
      }

      svgPaths.forEach(path => {
        const p = new Path2D(path.d);
        if (!isStrokesOnly) ctx.fill(p);
        ctx.stroke(p);
      });
      ctx.restore();
    }

    function drawCountry(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D | null, texture: THREE.CanvasTexture, index: number, color: string, scale: number, strokeMultiplier: number = 1) {
      if (!ctx) return;
      canvas.width = svgViewBox[0] * scale;
      canvas.height = svgViewBox[1] * scale;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      if (index === -1) {
        texture.needsUpdate = true;
        return;
      }

      ctx.save();
      ctx.scale(scale, scale);
      ctx.translate(0, -offsetY * svgViewBox[1]);
      
      ctx.fillStyle = color;
      ctx.strokeStyle = strokeMultiplier > 1 ? params.clickedColor : params.strokeColor;
      ctx.lineWidth = params.strokeWidth * strokeMultiplier;

      const p = new Path2D(svgPaths[index].d);
      ctx.fill(p);
      ctx.stroke(p);
      
      ctx.restore();
      texture.needsUpdate = true;
    }

    function prepareInitialTextures() {
      drawMap(mapCanvas, mapCtx, 1);
      mapTexture.needsUpdate = true;

      drawMap(strokesCanvas, strokesCtx, 1, true);
      strokesTexture.needsUpdate = true;
    }

    function prepareHiResTextures() {
      drawMap(mapCanvas, mapCtx, params.hiResScalingFactor);
      mapTexture.needsUpdate = true;

      drawMap(strokesCanvas, strokesCtx, params.hiResScalingFactor, true);
      strokesTexture.needsUpdate = true;
      setCountryName(hoveredCountryIdx !== -1 ? (svgPaths[hoveredCountryIdx]?.name || '') : '');
    }

    function handleCountryClick(idx: number) {
      if (clickedCountryIdx === idx) return;
      clickedCountryIdx = idx;

      const name = svgPaths[idx].name || '';
      const id = svgPaths[idx].id || '';
      setClickedCountry({ name, id });

      drawCountry(clickCanvas, clickCtx, clickTexture, idx, params.hoverColor, params.lowResScalingFactor, 4);
      globeClickedMesh.visible = true;

      gsap.killTweensOf(globeClickedMesh.scale);
      globeClickedMesh.scale.set(1, 1, 1);
      gsap.to(globeClickedMesh.scale, {
        x: 1.02,
        y: 1.02,
        z: 1.02,
        duration: 0.5,
        ease: 'back.out(1.5)'
      });

      targetZoom = 1.5;
      gsap.to(camera, {
        zoom: targetZoom,
        duration: 0.8,
        ease: 'power2.out',
        onUpdate: () => camera.updateProjectionMatrix(),
      });

      if (controls && !isDeviceMotionActive) {
        controls.autoRotate = false;
      }

      if (clickTimeout) clearTimeout(clickTimeout);
      clickTimeout = setTimeout(() => {
        revertClick();
      }, 3000);
    }

    function revertClick() {
      if (clickedCountryIdx === -1) return;
      clickedCountryIdx = -1;
      setClickedCountry(null);
      
      gsap.to(globeClickedMesh.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: 0.5,
        onComplete: () => {
          if (clickedCountryIdx === -1) {
            globeClickedMesh.visible = false;
          }
        }
      });
      
      targetZoom = 1;
      gsap.to(camera, {
        zoom: targetZoom,
        duration: 0.8,
        ease: 'power2.inOut',
        onUpdate: () => camera.updateProjectionMatrix(),
      });

      if (controls && !isDeviceMotionActive) {
        controls.autoRotate = true;
      }
    }

    function updateMap(uv = { x: 0, y: 0 }, isClick = false) {
      if (!pickingCtx) return false;
      
      const x = Math.floor(uv.x * pickingCanvas.width);
      const y = Math.floor((1 - uv.y) * pickingCanvas.height);
      
      const pixel = pickingCtx.getImageData(x, y, 1, 1).data;
      const id = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
      const index = id - 1;

      if (index >= 0 && index < svgPaths.length) {
        if (isClick) {
          handleCountryClick(index);
          return true;
        } else if (index !== hoveredCountryIdx) {
          hoveredCountryIdx = index;
          globeSelectionOuterMesh.visible = true;
          
          drawCountry(highlightCanvas, highlightCtx, highlightTexture, index, params.hoverColor, params.lowResScalingFactor);
          setCountryName(svgPaths[index].name || '');
          
          gsap.killTweensOf(globeSelectionOuterMesh.scale);
          globeSelectionOuterMesh.scale.set(1, 1, 1);
          gsap.to(globeSelectionOuterMesh.scale, {
            x: 1.015,
            y: 1.015,
            z: 1.015,
            duration: 0.4,
            ease: 'back.out(1.5)'
          });
        }
        return true;
      }
      return false;
    }

    function clearHover() {
      if (hoveredCountryIdx !== -1) {
        hoveredCountryIdx = -1;
        setCountryName('');
        gsap.to(globeSelectionOuterMesh.scale, {
          x: 1,
          y: 1,
          z: 1,
          duration: 0.3,
          onComplete: () => {
            if (hoveredCountryIdx === -1) {
              globeSelectionOuterMesh.visible = false;
              drawCountry(highlightCanvas, highlightCtx, highlightTexture, -1, '', 1);
            }
          }
        });
      }
    }

    function handleDeviceOrientation(event: DeviceOrientationEvent) {
      if (!isDeviceMotionActive || event.beta === null || event.gamma === null) return;
      
      let beta = event.beta; // -180 to 180
      let gamma = event.gamma; // -90 to 90

      beta = Math.max(-90, Math.min(90, beta));
      gamma = Math.max(-90, Math.min(90, gamma));

      targetRotationX = THREE.MathUtils.degToRad(beta - 45) * 0.5;
      targetRotationY = THREE.MathUtils.degToRad(gamma) * 0.5;
    }

    function render() {
      if (controls) controls.update();
      
      if (isDeviceMotionActive) {
        globeGroup.rotation.x += (targetRotationX - globeGroup.rotation.x) * 0.1;
        globeGroup.rotation.y += (targetRotationY - globeGroup.rotation.y) * 0.1;
      }

      if (isHoverable) {
        rayCaster.setFromCamera(pointer, camera);
        const intersects = rayCaster.intersectObject(globeStrokesMesh);
        if (intersects.length && intersects[0].uv) {
          const isHoveringCountry = updateMap(intersects[0].uv);
          if (!isHoveringCountry) {
            clearHover();
          }
        } else {
          clearHover();
        }
      }

      if (isTouchScreen && isHoverable) {
        isHoverable = false;
      }

      renderer.render(scene, camera);
    }

    function updateSize() {
      const side = Math.min(500, Math.min(window.innerWidth, window.innerHeight) - 50);
      containerEl.style.width = side + 'px';
      containerEl.style.height = side + 'px';
      renderer.setSize(side, side);
    }

    function createControls() {
      gui = new GUI();
      gui.close();

      gui.addColor(params, 'strokeColor').onChange(prepareHiResTextures).name('stroke');
      gui.addColor(params, 'defaultColor').onChange(prepareHiResTextures).name('color');
      gui.addColor(params, 'hoverColor').onChange(() => {
        if (hoveredCountryIdx !== -1) {
          drawCountry(highlightCanvas, highlightCtx, highlightTexture, hoveredCountryIdx, params.hoverColor, params.lowResScalingFactor);
        }
        if (clickedCountryIdx !== -1) {
          drawCountry(clickCanvas, clickCtx, clickTexture, clickedCountryIdx, params.hoverColor, params.lowResScalingFactor, 4);
        }
      }).name('highlight');
      gui.addColor(params, 'clickedColor').name('clicked highlight');
      gui.addColor(params, 'fogColor')
        .onChange(() => {
          scene.fog = new THREE.Fog(params.fogColor, 0, params.fogDistance);
          document.body.style.backgroundColor = params.fogColor;
        })
        .name('fog');
      gui.add(params, 'fogDistance', 1, 4)
        .onChange(() => {
          scene.fog = new THREE.Fog(params.fogColor, 0, params.fogDistance);
        })
        .name('fog distance');
      gui.add(params, 'nightLights')
        .onChange((value: boolean) => {
          gsap.to((nightLightsMesh.material as THREE.MeshBasicMaterial), {
            opacity: value ? 0.8 : 0,
            duration: 1,
          });
        })
        .name('night lights');
    }

    function updateMousePosition(eX: number, eY: number) {
      pointer.x = ((eX - containerEl.offsetLeft) / containerEl.offsetWidth) * 2 - 1;
      pointer.y = -((eY - containerEl.offsetTop) / containerEl.offsetHeight) * 2 + 1;
    }

    const handleTouchStart = () => {
      isTouchScreen = true;
    };
    const handleMouseMove = (e: MouseEvent) => {
      updateMousePosition(e.clientX, e.clientY);
    };
    const handleClick = (e: MouseEvent) => {
      updateMousePosition(e.clientX, e.clientY);
      
      rayCaster.setFromCamera(pointer, camera);
      const intersects = rayCaster.intersectObject(globeStrokesMesh);
      if (intersects.length && intersects[0].uv) {
        const clicked = updateMap(intersects[0].uv, true);
        if (!clicked) {
          revertClick();
        }
      } else {
        revertClick();
      }
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      
      const zoomDelta = e.deltaY > 0 ? -0.3 : 0.3;
      targetZoom = Math.max(0.8, Math.min(3, targetZoom + zoomDelta));
      
      gsap.to(camera, {
        zoom: targetZoom,
        duration: 0.5,
        ease: 'power2.out',
        onUpdate: () => camera.updateProjectionMatrix(),
      });
    };

    containerEl.addEventListener('touchstart', handleTouchStart);
    containerEl.addEventListener('mousemove', handleMouseMove);
    containerEl.addEventListener('click', handleClick);
    canvasEl.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    window.addEventListener('resize', updateSize);
    initScene();
    createControls();

    if (isDeviceMotionActive) {
      window.addEventListener('deviceorientation', handleDeviceOrientation);
      if (controls) controls.autoRotate = false;
    } else {
      if (controls) controls.autoRotate = true;
    }

    document.body.style.backgroundColor = params.fogColor;

    return () => {
      containerEl.removeEventListener('touchstart', handleTouchStart);
      containerEl.removeEventListener('mousemove', handleMouseMove);
      containerEl.removeEventListener('click', handleClick);
      canvasEl.removeEventListener('wheel', handleWheel, { capture: true } as any);
      window.removeEventListener('resize', updateSize);
      window.removeEventListener('deviceorientation', handleDeviceOrientation);
      gsap.ticker.remove(render);
      gui.destroy();
      renderer.dispose();
      document.body.style.backgroundColor = '';
    };
  }, [isLoaded, isDeviceMotionActive]);

  return (
    <div className="w-full h-full flex justify-center items-center relative z-10 transition-colors duration-300">
      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#e4e5e6] z-50">
          <div className="text-2xl font-bold text-gray-600 animate-pulse">Loading World Data...</div>
        </div>
      )}
      <div className="globe-wrapper mt-[9vh] relative" ref={containerRef}>
        <canvas id="globe-3d" ref={canvasRef} className="cursor-pointer select-none outline-none"></canvas>
        <div className="info absolute top-0 left-0 w-full text-center h-full flex justify-center items-center pointer-events-none">
          <span className="font-bold text-shadow px-3 py-1 rounded text-3xl text-white drop-shadow-md">{countryName}</span>
        </div>
      </div>
      {deviceMotionSupported && (
        <button
          onClick={requestDeviceOrientation}
          className={`absolute top-4 left-4 p-3 rounded-full shadow-lg transition-colors z-50 ${
            isDeviceMotionActive ? 'bg-[#00C9A2] text-white' : 'bg-white text-gray-800 hover:bg-gray-100'
          }`}
          title={isDeviceMotionActive ? "Disable device motion" : "Enable device motion"}
        >
          <Compass size={24} />
        </button>
      )}

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex gap-2 bg-white/80 backdrop-blur-md p-2 rounded-full shadow-lg z-50 overflow-x-auto max-w-[90vw] hide-scrollbar">
        {regions.map((region) => (
          <button
            key={region.name}
            onClick={() => {
              setSelectedRegion(region.name);
              if ((window as any).rotateToRegion) {
                (window as any).rotateToRegion(region.rotX, region.rotY);
              }
            }}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              selectedRegion === region.name
                ? 'bg-gray-900 text-white'
                : 'bg-transparent text-gray-700 hover:bg-gray-200'
            }`}
          >
            {region.name}
          </button>
        ))}
      </div>
      
      {clickedCountry && (
        <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm p-6 rounded-xl shadow-2xl z-50 max-w-sm border border-gray-200 animate-in fade-in slide-in-from-right-4 duration-300">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{clickedCountry.name}</h2>
          <div className="space-y-2 text-sm text-gray-600">
            <p className="flex justify-between border-b border-gray-100 pb-1">
              <span className="font-medium">Country Code:</span>
              <span className="font-mono">{clickedCountry.id || 'N/A'}</span>
            </p>
            
            {countryDetails && (
              <>
                <p className="flex justify-between border-b border-gray-100 pb-1">
                  <span className="font-medium">Capital:</span>
                  <span>{countryDetails.capital}</span>
                </p>
                <p className="flex justify-between border-b border-gray-100 pb-1">
                  <span className="font-medium">Population:</span>
                  <span>{countryDetails.population.toLocaleString()}</span>
                </p>
                <p className="flex justify-between border-b border-gray-100 pb-1">
                  <span className="font-medium">Region:</span>
                  <span className="text-right">{countryDetails.region} {countryDetails.subregion ? `(${countryDetails.subregion})` : ''}</span>
                </p>
                <p className="flex justify-between border-b border-gray-100 pb-1">
                  <span className="font-medium">Currencies:</span>
                  <span className="text-right">{countryDetails.currencies}</span>
                </p>
                <p className="flex justify-between border-b border-gray-100 pb-1">
                  <span className="font-medium">Languages:</span>
                  <span className="text-right truncate max-w-[150px]" title={countryDetails.languages}>{countryDetails.languages}</span>
                </p>
              </>
            )}
            
            {isLoadingWeather ? (
              <div className="py-4 flex justify-center items-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
              </div>
            ) : weatherData ? (
              <div className="mt-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                <h3 className="font-semibold text-gray-800 mb-2 border-b border-gray-200 pb-1">Current Weather in {weatherData.capital}</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2">
                    <Thermometer size={16} className="text-red-500" />
                    <span>{weatherData.temperature}°C</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Wind size={16} className="text-blue-500" />
                    <span>{weatherData.windspeed} km/h</span>
                  </div>
                  <div className="flex items-center gap-2 col-span-2">
                    <Cloud size={16} className="text-gray-500" />
                    <span>{getWeatherDescription(weatherData.weathercode)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 italic text-center py-2">Weather data unavailable</p>
            )}

            <div className="mt-4 pt-4 border-t border-gray-200">
              <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <Sparkles size={16} className="text-purple-500" />
                AI Summary
              </h3>
              {isLoadingSummary ? (
                <div className="py-2 flex justify-center items-center">
                  <div className="animate-pulse flex space-x-2">
                    <div className="h-2 w-2 bg-purple-400 rounded-full"></div>
                    <div className="h-2 w-2 bg-purple-400 rounded-full animation-delay-200"></div>
                    <div className="h-2 w-2 bg-purple-400 rounded-full animation-delay-400"></div>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-gray-700">
                  <p className="leading-relaxed">{aiSummary}</p>
                  {groundingSources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <p className="text-xs text-gray-500 mb-1 font-medium">Sources:</p>
                      <ul className="text-xs space-y-1">
                        {groundingSources.map((source, idx) => (
                          <li key={idx}>
                            <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate block">
                              {source.title || source.uri}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Removed hidden SVGs for performance */}
    </div>
  );
}
