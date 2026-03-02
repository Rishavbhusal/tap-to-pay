import { useIsMobile } from "@/hooks/use-mobile";
import { Smartphone } from "lucide-react";

/**
 * Detects mobile and shows a "Open in Phantom" deep-link button so
 * users on Android/iOS Chrome can connect their Phantom wallet.
 *
 * Phantom's universal link format:
 *   https://phantom.app/ul/browse/<encoded_dapp_url>
 *
 * This opens the current dApp URL inside Phantom's in-app browser,
 * which allows the wallet adapter to detect Phantom automatically.
 */
export default function MobileWalletHelper() {
  const isMobile = useIsMobile();

  if (!isMobile) return null;

  const phantomBrowseUrl = `https://phantom.app/ul/browse/${encodeURIComponent(
    window.location.href
  )}`;

  return (
    <div className="mt-4 w-full space-y-3">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">or on mobile</span>
        </div>
      </div>

      <a
        href={phantomBrowseUrl}
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full rounded-xl bg-[#ab9ff2] hover:bg-[#9580ff] text-white font-semibold py-3 px-4 transition-colors"
      >
        <Smartphone className="w-5 h-5" />
        Open in Phantom App
      </a>

      <p className="text-muted-foreground text-xs text-center leading-relaxed">
        On mobile, open this page inside <strong>Phantom&apos;s browser</strong> to
        connect your wallet. Tap the button above or open Phantom → Browser
        tab → paste this URL.
      </p>
    </div>
  );
}
