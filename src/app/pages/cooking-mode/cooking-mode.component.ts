import { Component, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import { RecipeService } from '../../services';
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

  recipe: Recipe | undefined;
  currentStep = 0;
  timer: number | null = null;
  timerDisplay = '00:00';
  timerRunning = false;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.recipe = this.recipeService.getRecipeById(id);
      if (!this.recipe) {
        this.router.navigate(['/recipes']);
      }
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
        // Play sound or show notification
        alert('Timer finished!');
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
