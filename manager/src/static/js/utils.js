// Copyright (C) 2024 Intel Corporation
//
// This software and the related documents are Intel copyrighted materials,
// and your use of them is governed by the express license under which they
// were provided to you ("License"). Unless the License provides otherwise,
// you may not use, modify, copy, publish, distribute, disclose or transmit
// this software or the related documents without Intel's prior written permission.
//
// This software and the related documents are provided as is, with no express
// or implied warranties, other than those that are expressly stated in the License.

'use strict';

import {
  FX, FY, CX, CY,
  K1, K2, P1, P2, K3, REST_URL
} from "/static/js/constants.js";

// Convert a point from pixels to meters
function pixelsToMeters(pixels, scale, scene_y_max) {
  var meters = [];

  // Scale-only in x
  meters[0] = parseFloat(pixels[0] / scale);

  // Move y axis to bottom and also scale
  meters[1] = parseFloat((scene_y_max - pixels[1]) / scale);

  if (pixels.length == 3) {
    // Leave z alone
    meters[2] = pixels[2].toFixed(scene_precision);
  }

  return meters;
}

// Convert a point from meters to pixels
function metersToPixels(meters, scale, scene_y_max) {
  var pixels = [];

  // Scale-only in x
  pixels[0] = Math.round(meters[0] * scale);

  // Move y axis to top and also scale
  pixels[1] = Math.round(scene_y_max - (meters[1] * scale));

  // z, if provided, remains unchanged since it should be in meters already
  if (meters.length == 3) {
    pixels[2] = meters[2];
  }

  return pixels;
}

function compareIntrinsics(intrinsics, msgIntrinsics, distortion, msgDistortion) {
  if (intrinsics["fx"] === msgIntrinsics[FX] &&
    intrinsics["fy"] === msgIntrinsics[FY] &&
    intrinsics["cx"] === msgIntrinsics[CX] &&
    intrinsics["cy"] === msgIntrinsics[CY] &&
    distortion["k1"] === msgDistortion[K1] &&
    distortion["k2"] === msgDistortion[K2] &&
    distortion["p1"] === msgDistortion[P1] &&
    distortion["p2"] === msgDistortion[P2] &&
    distortion["k3"] === msgDistortion[K3]) {
    return true;
  }
  return false;
}

const waitUntil = (condition, checkInterval, maxWaitTime) => {
  return new Promise((resolve, reject) => {
    let interval = setInterval(() => {
      if (condition()) {
        clearInterval(interval);
        clearTimeout(timeout);
        resolve();
      }
    }, checkInterval);

    let timeout = setTimeout(() => {
      clearInterval(interval);
      reject(new Error('Timeout exceeded'));
    }, maxWaitTime);
  });
};

function initializeOpencv() {
  let cvLoaded = cv.getBuildInformation?.() !== undefined;

  cv.onRuntimeInitialized = () => {
    cvLoaded = true;
  };

  const waitUntil = (condition, checkInterval = 1000) => {
    return new Promise(resolve => {
      let interval = setInterval(() => {
        if (navigator.userAgent.includes("Firefox") ? condition() : !condition())
          return;
        clearInterval(interval);
        console.log("OpenCV loaded");
        resolve();
      }, checkInterval);
    });
  };
  return { waitUntil, cvLoaded };
}

// Responsive canvas implementation (handle browser window resizing)
// https://threejs.org/manual/#en/responsive
function resizeRendererToDisplaySize(renderer) {
  const canvas = renderer.domElement;
  const pixelRatio = window.devicePixelRatio;
  const width = canvas.clientWidth * pixelRatio | 0;
  const height = canvas.clientHeight * pixelRatio | 0;
  const needResize = canvas.width !== width || canvas.height !== height;

  if (needResize) {
    renderer.setSize(width, height, false);
  }

  return needResize;
}

function checkWebSocketConnection(url) {
  return new Promise((resolve, reject) => {
    try {
      console.log(`Attempting to connect to: ${url}`);
      const ws = new WebSocket(url);

      ws.onopen = () => {
        console.log(`Successfully connected to ${url}`);
        ws.close();
        resolve(url);
      };

      ws.onerror = (error) => {
        reject(null);
      };

    } catch (err) {
      console.log(`Error during WebSocket creation for ${url}:`, err);
    }
  });
}

async function getResource(folder, window) {
  try {
    const response = await fetch(`https://${window.location.hostname}/media/list/${folder}/`);

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }

    const data = await response.json();
    const files = data.files.filter(filename => !filename.endsWith('.json'));
    
    console.log("Files excluding .json:", files);
    return files;

  } catch (err) {
    console.error("Error fetching file list:", err);
    return [];
  }
}

async function uploadResource(file, authToken, jsonData) {
  const formData = new FormData();
  formData.append('map', file);
  formData.append('name', jsonData.name);
  formData.append('uid', jsonData.uid)

  console.log(authToken);
  try {
    const response = await fetch(`${REST_URL}/scene`, {
      method: 'POST',
      headers: {
      'Authorization': authToken
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Failed to create scene: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('scene created:', data);
    return data;

  } catch (err) {
    console.error('Error in scene creation:', err);
    return null;
  }
}

async function importScene(zipURL, restClient, basename, window, authToken) {
  try {
    const jsonResponse = await fetch(zipURL + '/' + basename + '.json');

    if (!jsonResponse.ok) {
      throw new Error(`Failed to fetch JSON: ${response.statusText}`);
    }
    const jsonData = await jsonResponse.json();  // Parse JSON response
    console.log("Parsed JSON Data:", jsonData);
    const files = await getResource(basename, window);
    const resourceUrl = `/media/${basename}/${files[0]}`;
    console.log("Resource file found:", resourceUrl);

    const response = await fetch(resourceUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch file');
    }
    const blob = await response.blob();

    // Convert Blob to File with desired filename
    console.log(blob.type)
    const file = new File([blob], `${jsonData.name}.png`, { type: blob.type });
    const resp = await uploadResource(file, authToken, jsonData);
    if (resp) {
      const scene_id = resp.uid;
      delete jsonData.name;
      delete jsonData.map
      let cameras = jsonData.cameras;

      const updateResponse = await restClient.updateScene(scene_id, jsonData);
      console.log('DKA')
      console.log(updateResponse)

      for (let cam of cameras) {
        let cameraData = {
          'name': cam.name,
          'transform_type': 'euler',
          'translation': cam.translation,
          'scene': scene_id,
          'rotation': cam.rotation,
          // 'intrinsics': cam.intrinsics,
          // 'distortion': cam.distortion,
          'scale': cam.scale
        };
        const createResponse = await restClient.createCamera(cameraData);
        console.log('DKA - 2')
        console.log(createResponse)
      }

    } else {
      console.log('Scene creation failed.');
    }
  } catch (err) {
    console.error("Error processing scene import:", err);
  }
}

export { pixelsToMeters, metersToPixels, compareIntrinsics, waitUntil, initializeOpencv, resizeRendererToDisplaySize, checkWebSocketConnection, importScene };
