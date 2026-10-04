import { Component, OnInit, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, RecipeService } from '../../services';
import { Recipe, RecipeCreateInput } from '../../models';
import { RecipeFormComponent } from '../../components/recipe-form/recipe-form.component';

@Component({
  selector: 'app-edit-recipe',
  standalone: true,
  imports: [CommonModule, RecipeFormComponent],
  templateUrl: './edit-recipe.component.html'
})
export class EditRecipeComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private recipeService = inject(RecipeService);
  private authService = inject(AuthService);

  recipe: Recipe | undefined;
  isSubmitting = signal(false);
  errorMessage = signal('');

  private recipeId: string | null = null;
  private resolved = false;

  constructor() {
    effect(() => {
      if (this.recipe || !this.recipeId || this.resolved) return;
      if (!this.authService.initialized()) return;
      this.resolved = true;
      this.recipeService.resolveRecipe(this.recipeId).subscribe(recipe => {
        const user = this.authService.currentUser();
        if (!recipe || !user || recipe.ownerId !== user.id) {
          // Not found, or not yours to edit.
          this.router.navigate(this.recipeId ? ['/recipes', this.recipeId] : ['/recipes']);
          return;
        }
        this.recipe = recipe;
      });
    });
  }

  ngOnInit(): void {
    this.recipeId = this.route.snapshot.paramMap.get('id');
    if (!this.recipeId) {
      this.router.navigate(['/recipes']);
    }
  }

  submit(payload: RecipeCreateInput): void {
    if (!this.recipeId) return;
    this.isSubmitting.set(true);
    this.errorMessage.set('');

    this.recipeService.updateRecipe(this.recipeId, payload).subscribe({
      next: recipe => this.router.navigate(['/recipes', recipe.id]),
      error: () => {
        this.isSubmitting.set(false);
        this.errorMessage.set('Something went wrong saving your changes. Please try again.');
      }
    });
  }
}
