export class Vis {
  public pub(): number { return 1; }
  protected prot(): number { return 2; }
  private priv(): number { return 3; }
  #hard(): number { return 4; }
  all(): number { return this.pub() + this.prot() + this.priv() + this.#hard(); }
}
new Vis().all();
