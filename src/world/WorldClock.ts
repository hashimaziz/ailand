export class WorldClock {
  // Start at 8:00 AM (8 * 3600 seconds)
  public time: number = 8 * 3600; 
  public speedMultiplier = 60; // 1 real sec = 1 in-game minute

  public update(realDeltaSeconds: number) {
    this.time += realDeltaSeconds * this.speedMultiplier;
  }
  
  public getHourOfDay(): number {
    return (this.time / 3600) % 24;
  }
  
  public getFormattedTime(): string {
    const hours = Math.floor(this.getHourOfDay());
    const minutes = Math.floor((this.time % 3600) / 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
}
