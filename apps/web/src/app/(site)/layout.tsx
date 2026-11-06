import { RefCapture } from "@/features/portfolio/Incentives";
import { Header, MobileNav } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { DeploymentBanner } from "@/components/layout/DeploymentBanner";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RefCapture />
      <Header />
      <DeploymentBanner />
      <main id="main" className="mx-auto w-full max-w-[84rem] px-4 pt-6 md:px-6 md:pt-8">
        {children}
      </main>
      <Footer />
      <MobileNav />
    </>
  );
}
