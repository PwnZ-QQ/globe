import Globe from '@/components/Globe';
import CameraView from '@/components/CameraView';

export default function Home() {
  return (
    <main className="w-full h-screen bg-[#e4e5e6] overflow-hidden relative">
      <Globe />
      <CameraView />
    </main>
  );
}
