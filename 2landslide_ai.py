from sklearn.tree import DecisionTreeClassifier

# Example training data
X = [
    [30,5,50,0.01],
    [60,20,70,0.03],
    [85,60,85,0.06]
]

y = [0,1,2]  # risk levels

model = DecisionTreeClassifier()
model.fit(X,y)

prediction = model.predict([[80,50,78,0.05]])

print("Predicted Risk Level:", prediction)
