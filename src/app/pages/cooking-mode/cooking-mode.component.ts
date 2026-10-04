import { Component, inject, OnInit, effect } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { RecipeService, ToastService } from '../../services';
import { Recipe } from '../../models';

@Component({
  selector: 'app-cooking-mode',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './cooking-mode.component.html',
  styleUrls: ['./cooking-mode.component.scss']
})
export class CookingModeComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private recipeService = inject(RecipeService);
  private toastService = inject(ToastService);

  recipe: Recipe | undefined;
  currentStep = 0;
  timer: number | null = null;
  timerDisplay = '00:00';
  timerRunning = false;

  private recipeId: string | null = null;
  private resolveAttempted = false;

  constructor() {
    // The recipe catalog loads asynchronously from the backend, so resolve the
    // route's recipe once it arrives instead of only looking it up in ngOnInit.
    effect(() => {
      if (this.recipe || !this.recipeId) return;
      const found = this.recipeService.recipes().find(r => r.id === this.recipeId);
      if (found) {
        this.setRecipe(found);
      } else if (this.recipeService.recipesLoaded() && !this.resolveAttempted) {
        // Not in the discovery-backed catalog - it may still be a private/unlisted recipe
        // or a twist you own, so fall back to a direct-by-id fetch before giving up.
        this.resolveAttempted = true;
        this.recipeService.resolveRecipe(this.recipeId).subscribe(recipe => {
          if (recipe) {
            this.setRecipe(recipe);
          } else {
            this.router.navigate(['/recipes']);
          }
        });
      }
    });
  }

  private setRecipe(recipe: Recipe): void {
    if (recipe.steps.length === 0) {
      // No cooking guide for a recipe with no steps.
      this.router.navigate(['/recipes', recipe.id]);
      return;
    }
    this.recipe = recipe;
  }

  ngOnInit(): void {
    this.recipeId = this.route.snapshot.paramMap.get('id');
    if (!this.recipeId) {
      this.router.navigate(['/recipes']);
    }
  }

  get currentStepData() {
    if (!this.recipe) return null;
    return this.recipe.steps[this.currentStep];
  }

  get progress() {
    if (!this.recipe) return 0;
    return ((this.currentStep + 1) / this.recipe.steps.length) * 100;
  }

  nextStep(): void {
    if (this.recipe && this.currentStep < this.recipe.steps.length - 1) {
      this.currentStep++;
      this.stopTimer();
    }
  }

  previousStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--;
      this.stopTimer();
    }
  }

  goToStep(step: number): void {
    this.currentStep = step;
    this.stopTimer();
  }

  startTimer(minutes: number): void {
    if (this.timerRunning) return;
    
    let seconds = minutes * 60;
    this.timerRunning = true;
    
    this.timer = window.setInterval(() => {
      seconds--;
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      this.timerDisplay = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      
      if (seconds <= 0) {
        this.stopTimer();
        this.toastService.show('Timer finished!');
      }
    }, 1000);
  }

  stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.timerRunning = false;
    this.timerDisplay = '00:00';
  }

  exitCookingMode(): void {
    if (confirm('Are you sure you want to exit cooking mode?')) {
      this.stopTimer();
      this.router.navigate(['/recipes', this.recipe?.id]);
    }
  }

  formatTime(minutes: number): string {
    if (minutes < 60) {
      return `${minutes} min`;
    }
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
}
