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

async function bulkCreate(items, scene_id, createFn, label) {
  if (!items || items.length === 0) {
    return;
  }
  const tasks = items.map(item => {
    item.scene = scene_id;
    if (scene_id) {
      item.scene = scene_id;
    }
    return createFn(item)
      .then(response => {
        console.log(`DKA - ${label} Response:`, response.errors);
        return response.errors;
      })
      .catch(err => {
        console.error(`Error creating ${label}:`, err);
      });
  });
  await Promise.all(tasks);
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
  console.log(authToken);

  try {
    const response = await fetch(`${REST_URL}/scene`, {
      method: 'POST',
      headers: {
        'Authorization': authToken
      },
      body: formData
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`Failed to create scene: ${response.status} ${response.statusText}`);
      console.error('Response body:', responseText);
      throw new Error(`Server returned ${response.status}`);
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseErr) {
      console.warn('Response is not valid JSON:', responseText);
      data = responseText;
    }

    console.log('Scene created:', data);
    return data;

  } catch (err) {
    console.error('Error in scene creation:', err);
    return null;
  }
}

async function importScene(zipURL, restClient, basename, window, authToken) {
  //Issues
  //upload gets renamed if uploading same file
  //refresh page after upload is completed
  //clean up
  //Being able to show feedback to user when things error out
  //Calibration points get carried
  //scene hierarchy in is being carried

  try {
    const jsonResponse = await fetch(`${zipURL}/${basename}.json`);

    if (!jsonResponse.ok) {
      throw new Error(`Failed to fetch JSON: ${jsonResponse.statusText}`);
    }

    const jsonData = await jsonResponse.json();
    console.log("Parsed JSON Data:", jsonData);

    const files = await getResource(basename, window);
    const resourceUrl = `/media/${basename}/${files[0]}`;
    console.log("Resource file found:", resourceUrl);

    const response = await fetch(resourceUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch resource file');
    }

    const blob = await response.blob();
    const blobType = blob.type.split('/')[1];
    let fileType = '.png'
    if (blobType === 'gltf-binary') {
      fileType = '.glb';
    }
    console.log('resource type', blob.type);
    const file = new File([blob], `${jsonData.name}${fileType}`, { type: blob.type });

    const resp = await uploadResource(file, authToken, jsonData);

    if (!resp) {
      console.error('Scene creation failed.');
      return;
    }
    const scene_id = resp.uid;
    const sceneData = {
      scale: jsonData.scale,
      regulate_rate: jsonData.regulate_rate,
      external_update_rate: jsonData.external_update_rate,
      camera_calibration: jsonData.camera_calibration,
      apriltag_size: jsonData.apriltag_size,
      number_of_localizations: jsonData.number_of_localizations,
      global_feature: jsonData.global_feature,
      minimum_number_of_matches: jsonData.minimum_number_of_matches,
      inlier_threshold: jsonData.inlier_threshold,
      output_lla: jsonData.output_lla
    };

    const updateResponse = await restClient.updateScene(scene_id, sceneData);
    console.log('Scene updated:', updateResponse);

    // Bulk creation of resources
    await bulkCreate(
      jsonData.cameras.map(cam => ({
        name: cam.name,
        transform_type: 'euler',
        translation: cam.translation,
        scene: scene_id,
        rotation: cam.rotation,
        scale: cam.scale
      })),
      scene_id,
      restClient.createCamera.bind(restClient),
      'Camera'
    );

    await bulkCreate(jsonData.regions, scene_id, restClient.createRegion.bind(restClient), 'Region');
    await bulkCreate(jsonData.tripwires, scene_id, restClient.createTripwire.bind(restClient), 'Tripwire');
    await bulkCreate(jsonData.sensors, scene_id, restClient.createSensor.bind(restClient), 'Sensor');
    await bulkCreate(jsonData.object_library, null, restClient.createAsset.bind(restClient), 'Assets');

  } catch (err) {
    console.error("Error processing scene import:", err);
  }
}

export { pixelsToMeters, metersToPixels, compareIntrinsics, waitUntil, initializeOpencv, resizeRendererToDisplaySize, checkWebSocketConnection, importScene };
