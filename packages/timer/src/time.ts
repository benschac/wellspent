export interface FormattedElapsedTime {
  hundredths: string;
  label: string;
  minutes: string;
  seconds: string;
  value: string;
}

export function formatElapsedTime(elapsedMs: number): FormattedElapsedTime {
  const safeElapsedMs = Math.max(0, Math.floor(elapsedMs));
  const totalHundredths = Math.floor(safeElapsedMs / 10);
  const hundredths = totalHundredths % 100;
  const totalSeconds = Math.floor(totalHundredths / 100);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);

  const minuteText = String(minutes).padStart(2, "0");
  const secondText = String(seconds).padStart(2, "0");
  const hundredthText = String(hundredths).padStart(2, "0");

  return {
    hundredths: hundredthText,
    label: `${minutes} minutes, ${seconds} seconds, ${hundredths} hundredths`,
    minutes: minuteText,
    seconds: secondText,
    value: `${minuteText}:${secondText}.${hundredthText}`,
  };
}
