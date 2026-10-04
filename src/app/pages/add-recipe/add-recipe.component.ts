import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { RecipeService } from '../../services';
import { RecipeCreateInput } from '../../models';
import { RecipeFormComponent } from '../../components/recipe-form/recipe-form.component';

@Component({
  selector: 'app-add-recipe',
  standalone: true,
  imports: [RecipeFormComponent],
  templateUrl: './add-recipe.component.html',
  styleUrls: ['./add-recipe.component.scss']
})
export class AddRecipeComponent {
  private recipeService = inject(RecipeService);
  private router = inject(Router);

  isSubmitting = signal(false);
  errorMessage = signal('');

  submit(payload: RecipeCreateInput): void {
    this.isSubmitting.set(true);
    this.errorMessage.set('');

    this.recipeService.createRecipe(payload).subscribe({
      next: recipe => this.router.navigate(['/recipes', recipe.id]),
      error: () => {
        this.isSubmitting.set(false);
        this.errorMessage.set('Something went wrong creating the recipe. Please try again.');
      }
    });
  }
}
