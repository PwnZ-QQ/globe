'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff } from 'lucide-react';

export default function CameraView() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;

    async function setupCamera() {
      if (isCameraOn) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
          setError(null);
        } catch (err) {
          console.error("Error accessing camera:", err);
          setError("Could not access camera");
          setIsCameraOn(false);
        }
      } else {
        if (videoRef.current && videoRef.current.srcObject) {
          const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
          tracks.forEach(track => track.stop());
          videoRef.current.srcObject = null;
        }
      }
    }

    setupCamera();

    return () => {
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isCameraOn]);

  return (
    <div className="absolute bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {isCameraOn && (
        <div className="w-64 h-48 bg-black rounded-lg overflow-hidden shadow-lg border-2 border-white/20">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
      )}
      {error && (
        <div className="bg-red-500 text-white px-3 py-1 rounded text-sm shadow-lg">
          {error}
        </div>
      )}
      <button
        onClick={() => setIsCameraOn(!isCameraOn)}
        className={`p-3 rounded-full shadow-lg transition-colors ${
          isCameraOn ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-white hover:bg-gray-100 text-gray-800'
        }`}
        title={isCameraOn ? "Turn off camera" : "Turn on camera"}
      >
        {isCameraOn ? <CameraOff size={24} /> : <Camera size={24} />}
      </button>
    </div>
  );
}
